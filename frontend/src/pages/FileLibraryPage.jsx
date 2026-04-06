import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, AlertCircle, ArrowDown, ArrowUp, Bell, CheckCircle2, CheckSquare, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clock, Copy, Cpu, Download, Eye, FileCode, FileDown, FileJson, FileUp, Filter, FolderOpen, Globe, GripVertical, Grid3x3, HardDrive, History, Layers, LayoutDashboard, List, Lock, LogOut, Menu, Monitor, MoreVertical, Pause, Pencil, Play, PlayCircle, Plus, RefreshCw, Save, Search, Settings, Square, StopCircle, Tag, Terminal, Trash2, Upload, User, UserPlus, Users, Wifi, WifiOff, X, XCircle, Zap
} from 'lucide-react';
import { useTestStore } from '../store/useTestStore';
import api from '../services/api';
import { computeFileSignature } from '../utils/fileSignature';
import { getClientId } from '../utils/sessionStorage';
import {
  resolveFileOwnerDisplay,
  resolveOwnerDisplayName,
  isFileOwnerMine,
  isFileOwnerOtherUser,
} from '../utils/profileOwnerLabel';
import {
  TAG_PALETTE_MAP,
  TAG_PALETTE_KEYS,
  normalizeTagColorList,
  getFirstTagPillClass,
  syncTagColorListAfterTagChange,
  isExtraColumnHiddenFromLibraryTable,
  splitTagsComma,
  jobTagPillClasses,
} from '../utils/tagPalette';
import TagColorSwatchPicker from '../components/TagColorSwatchPicker';

// Set names that use this file (from fileLibrarySnapshot or items)
const getSetNamesUsingFile = (fileName, savedTestCaseSets) => {
  if (!fileName || !savedTestCaseSets?.length) return [];
  const norm = (v) => String(v || '').split('/').pop().trim().toLowerCase();
  const fNorm = norm(fileName);
  const names = [];
  for (const set of savedTestCaseSets) {
    const hasInSnapshot = set.fileLibrarySnapshot?.some((s) => norm(s?.name) === fNorm);
    const hasInItems = (set.items || []).some(
      (t) => norm(t?.vcdName) === fNorm || norm(t?.binName) === fNorm || norm(t?.linName) === fNorm
    );
    if (hasInSnapshot || hasInItems) names.push(set.name || set.id);
  }
  return names;
};

/** Pill classes for a saved set name, from job status map (running / pending / completed) or idle */
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

/** Returns list of { name, set } for each test case that uses this file (VCD / ERoM / ULP / MDI). */
const getTestCasesUsingFile = (fileName, savedTestCases, savedTestCaseSets) => {
  if (!fileName) return [];
  const norm = (v) => String(v || '').split('/').pop().trim().toLowerCase();
  const fNorm = norm(fileName);
  const out = [];
  const isUsedInTc = (tc) => {
    if (norm(tc?.vcdName) === fNorm || norm(tc?.binName) === fNorm || norm(tc?.linName) === fNorm) return true;
    const cmds = Array.isArray(tc.commands) ? tc.commands : [];
    if (cmds.some((c) => c && norm(c?.file) === fNorm)) return true;
    const extra = tc.extraColumns && typeof tc.extraColumns === 'object' ? tc.extraColumns : {};
    return Object.values(extra).some((v) => norm(v) === fNorm);
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

/**
 * Fallback (cross-user) references from Jobs.
 * Jobs are global in the UI, so every user should see the same Used-by / Sets when
 * profile test-case snapshots are missing/unloaded.
 */
const getJobRefsUsingFile = (fileName, jobs) => {
  if (!fileName) return { usedByTcs: [], setNames: [] };
  const norm = (v) => String(v || '').split('/').pop().trim().toLowerCase();
  const fNorm = norm(fileName);
  const usedBy = [];
  const setNames = [];
  const seenTc = new Set();
  const seenSet = new Set();

  (Array.isArray(jobs) ? jobs : []).forEach((job) => {
    const jobName = (job?.name || job?.configName || '').toString().trim();
    const addSet = (n) => {
      const s = String(n || '').trim();
      if (!s) return;
      const k = s.toLowerCase();
      if (seenSet.has(k)) return;
      seenSet.add(k);
      setNames.push(s);
    };

    (Array.isArray(job?.files) ? job.files : []).forEach((f) => {
      const vcd = norm(f?.vcd || f?.name);
      const erom = norm(f?.erom);
      const ulp = norm(f?.ulp);
      const tcName = (f?.testCaseName || '').toString().trim();
      const hit = (vcd && vcd === fNorm) || (erom && erom === fNorm) || (ulp && ulp === fNorm);
      if (!hit) return;

      if (jobName) addSet(jobName);
      const displayTc = tcName || (f?.name || '').toString().trim() || '—';
      const tcKey = `${displayTc}||${jobName || ''}`.toLowerCase();
      if (!seenTc.has(tcKey)) {
        seenTc.add(tcKey);
        usedBy.push({ name: displayTc, set: jobName || 'Job' });
      }
    });
  });

  return { usedByTcs: usedBy, setNames };
};

/** สร้าง id สำหรับแถว extra file ใน editor */
const newRawTcSlotId = () => `slot-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

/**
 * รวบรวมไฟล์เสริม (VCD2+, ERoM2+, ULP2+, MDI) จาก commands ก่อน แล้วเติมจาก extraColumns ถ้ายังไม่มีใน commands
 */
function collectExtraSlotsFromTc(tc) {
  const slots = [];
  const seen = new Set();
  const addSlot = (kind, file) => {
    const f = (file || '').trim();
    if (!f) return;
    const sig = `${kind}:${f}`;
    if (seen.has(sig)) return;
    seen.add(sig);
    slots.push({ id: newRawTcSlotId(), kind, file: f });
  };

  for (const c of tc.commands || []) {
    if (!c?.file?.trim()) continue;
    if (c.type === 'vcd') addSlot('vcd', c.file);
    else if (c.type === 'erom') addSlot('erom', c.file);
    else if (c.type === 'ulp') addSlot('ulp', c.file);
    else if (c.type === 'mdi') addSlot('mdi', c.file);
  }

  const ex = tc.extraColumns || {};
  const numFromKey = (k) => parseInt(String(k).match(/(\d+)$/)?.[1] || '0', 10);
  const addFromExtra = (key, kind) => {
    const val = String(ex[key] || '').trim();
    if (!val) return;
    const sig = `${kind}:${val}`;
    if (seen.has(sig)) return;
    addSlot(kind, val);
  };

  Object.keys(ex)
    .filter((k) => /^VCD\d+$/i.test(k) && numFromKey(k) >= 2)
    .sort((a, b) => numFromKey(a) - numFromKey(b))
    .forEach((k) => addFromExtra(k, 'vcd'));
  Object.keys(ex)
    .filter((k) => /^ERoM\d+$/i.test(k) && numFromKey(k) >= 2)
    .sort((a, b) => numFromKey(a) - numFromKey(b))
    .forEach((k) => addFromExtra(k, 'erom'));
  Object.keys(ex)
    .filter((k) => /^ULP\d+$/i.test(k) && numFromKey(k) >= 2)
    .sort((a, b) => numFromKey(a) - numFromKey(b))
    .forEach((k) => addFromExtra(k, 'ulp'));

  return slots;
}

/**
 * ป้ายชื่อคอลัมน์ในตาราง Raw Test Cases สำหรับแถว extra (ลำดับตามแถวใน editor)
 * VCD/ERoM/ULP: ไฟล์หลัก = คอลัมน์หลัก — ไฟล์เสริมเริ่มที่ *2 (VCD2, ERoM2, ULP2)
 * MDI: ไม่มีช่องหลักใน extraSlots — ใช้ MDI1, MDI2, …
 */
function getExtraSlotColumnLabel(kind, ordinalAmongKind) {
  const n = Math.max(1, ordinalAmongKind);
  if (kind === 'vcd') return `VCD${n + 1}`;
  if (kind === 'erom') return `ERoM${n + 1}`;
  if (kind === 'ulp') return `ULP${n + 1}`;
  if (kind === 'mdi') return `MDI${n}`;
  return '';
}

const isTcManuallyClosed = (tc) => {
  const vis = String(tc?.extraColumns?.vis || '').trim().toLowerCase();
  return vis === 'close' || vis === 'closed' || vis === 'lock' || vis === 'locked' || vis === 'private';
};

// System lock = test case is part of a running/pending job, so the user should not change it
const isTcSystemLocked = (tc) => tc?._status === 'running' || tc?._status === 'pending';

const normalizeFilenameForKey = (v) => String(v || '').trim().toLowerCase();

/**
 * Matches store `getTestCaseFilesKey` plus MDI entries from `commands`, so library rows and set items dedupe the same way.
 */
const tcSignatureKeyForDedupe = (tc) => {
  if (!tc || typeof tc !== 'object') return '';
  const vcd = normalizeFilenameForKey(tc.vcdName);
  const bin = normalizeFilenameForKey(tc.binName);
  const lin = normalizeFilenameForKey(tc.linName);
  const ex = tc.extraColumns && typeof tc.extraColumns === 'object' ? tc.extraColumns : {};
  const extraPairs = Object.keys(ex)
    .filter((k) => /^(erom|ulp|mdi)\d+$/i.test(String(k)))
    .map((k) => {
      const vv = normalizeFilenameForKey(ex[k]);
      return vv ? `${String(k).toUpperCase()}=${vv}` : null;
    })
    .filter(Boolean)
    .sort((a, b) => String(a).localeCompare(String(b)));
  const mdiCmds = (tc.commands || [])
    .filter((c) => c && c.type === 'mdi' && String(c.file || '').trim())
    .map((c) => normalizeFilenameForKey(c.file))
    .sort()
    .join('\0');
  const base = [vcd, bin, lin, ...extraPairs].join('\0');
  return mdiCmds ? `${base}\0mdi:${mdiCmds}` : base;
};

/** Same column resolution as Test Case Library table (commands + extraColumns). */
function getTcExtraColKeys(t) {
  const fromExtra = Object.keys(t.extraColumns || {});
  const fromCmds = [];
  (t.commands || []).filter((c) => c.type === 'vcd' && (c.file || '').trim()).forEach((_, i) => fromCmds.push(`VCD${i + 2}`));
  (t.commands || []).filter((c) => c.type === 'erom' && (c.file || '').trim()).forEach((_, i) => fromCmds.push(`ERoM${i + 2}`));
  (t.commands || []).filter((c) => c.type === 'ulp' && (c.file || '').trim()).forEach((_, i) => fromCmds.push(`ULP${i + 2}`));
  (t.commands || []).filter((c) => c.type === 'mdi').forEach((_, i) => fromCmds.push(`MDI${i + 1}`));
  return [...fromExtra, ...fromCmds];
}

function getTcExtraColVal(t, col) {
  const m = col.match(/^VCD(\d+)$/);
  if (m) {
    const idx = parseInt(m[1], 10) - 2;
    const vcds = (t.commands || []).filter((c) => c.type === 'vcd' && (c.file || '').trim());
    return vcds[idx]?.file ?? t.extraColumns?.[col] ?? '';
  }
  const m2 = col.match(/^ERoM(\d+)$/);
  if (m2) {
    const idx = parseInt(m2[1], 10) - 2;
    const eroms = (t.commands || []).filter((c) => c.type === 'erom' && (c.file || '').trim());
    return eroms[idx]?.file ?? t.extraColumns?.[col] ?? '';
  }
  const m3 = col.match(/^ULP(\d+)$/);
  if (m3) {
    const idx = parseInt(m3[1], 10) - 2;
    const ulps = (t.commands || []).filter((c) => c.type === 'ulp' && (c.file || '').trim());
    return ulps[idx]?.file ?? t.extraColumns?.[col] ?? '';
  }
  const m4 = col.match(/^MDI(\d+)$/);
  if (m4) {
    const idx = parseInt(m4[1], 10) - 1;
    const mdis = (t.commands || []).filter((c) => c.type === 'mdi');
    return mdis[idx]?.file ?? t.extraColumns?.[col] ?? '';
  }
  return t.extraColumns?.[col] ?? '';
}

const pickUniqueNameForAppend = (desired, usedSet) => {
  const base = (desired || '').trim() || 'Test case';
  if (!usedSet.has(base)) return base;
  let n = 2;
  while (usedSet.has(`${base} (${n})`)) n += 1;
  return `${base} (${n})`;
};

const cloneSavedLibraryTcToSetItem = (tc, finalName) => {
  const now = new Date().toISOString();
  const itemId = `tc-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const extra = tc.extraColumns && typeof tc.extraColumns === 'object' ? { ...tc.extraColumns } : {};
  const commands = Array.isArray(tc.commands)
    ? tc.commands.map((c, i) => ({
        ...c,
        id: `cmd-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 9)}`,
      }))
    : null;
  return {
    id: itemId,
    name: finalName,
    vcdName: tc.vcdName || '',
    binName: tc.binName || '',
    linName: tc.linName || '',
    boardId: tc.boardId || '',
    tryCount: typeof tc.tryCount === 'number' && tc.tryCount > 0 ? tc.tryCount : 1,
    extraColumns: Object.keys(extra).length ? extra : undefined,
    ...(commands && commands.length ? { commands } : {}),
    createdAt: tc.createdAt || now,
  };
};

/** Files tab — same keys as `TAG_PALETTE_MAP` (fileTagColors in store). */
const FILE_TAG_PALETTE_MAP = TAG_PALETTE_MAP;

// FILE LIBRARY PAGE — default: Test Case Library (เรียง set ลงมา แต่ละ set มีตารางแนวนอน + แสดงไฟล์); ปุ่มสลับView files in Library
const FileLibraryPage = ({ onNavigateToTestCases, onNavigateToRunSet }) => {
  const {
    uploadedFiles,
    addUploadedFile,
    removeUploadedFile,
    loading,
    errors,
    savedTestCaseSets,
    savedTestCases,
    removeSavedTestCase,
    addSavedTestCase,
    updateSavedTestCase,
    duplicateSavedTestCase,
    updateSavedTestCaseSet,
    appendToSavedTestCaseSet,
    removeSavedTestCaseSetRows,
    removeSavedTestCaseSet,
    fileTags,
    setFileTag,
    fileTagColors,
    setFileTagColor,
    fileDisplayNames,
    setFileDisplayName,
  } = useTestStore();
  const setFileToTestCaseDraft = useTestStore((s) => s.setFileToTestCaseDraft);
  const activeProfileId = useTestStore((s) => s.activeProfileId);
  const profiles = useTestStore((s) => s.profiles) || [];
  const sharedProfiles = useTestStore((s) => s.sharedProfiles) || [];
  const serverProfileDirectory = useTestStore((s) => s.serverProfileDirectory) || [];
  const activeProfile = profiles.find((p) => p.id === activeProfileId) || { id: 'default', name: 'Default' };
  const globalSavedTestCases = useTestStore((s) => s.globalSavedTestCases) || [];
  const globalSavedTestCaseSets = useTestStore((s) => s.globalSavedTestCaseSets) || [];
  const globalTestCaseDataLoaded = useTestStore((s) => s.globalTestCaseDataLoaded);
  const aggregateSavedTestCasesAcrossProfiles = useTestStore((s) => s.aggregateSavedTestCasesAcrossProfiles);
  const aggregateSavedTestCaseSetsAcrossProfiles = useTestStore((s) => s.aggregateSavedTestCaseSetsAcrossProfiles);
  const currentClientId = getClientId();
  const ownerLabelCtx = useMemo(
    () => ({
      profiles,
      sharedProfiles,
      serverProfileDirectory,
      activeProfileId,
      activeProfileName: activeProfile.name,
      currentClientId,
    }),
    [profiles, sharedProfiles, serverProfileDirectory, activeProfileId, activeProfile.name, currentClientId]
  );

  /** Cross-profile: same "Used by TC" / Sets for every profile once global snapshot is loaded. */
  const fileReferenceTestCases = useMemo(
    () => {
      const local = Array.isArray(savedTestCases) ? savedTestCases : [];
      // Prefer showing cross-profile references when server snapshot data already exists in store.
      // Some edge cases can leave `globalTestCaseDataLoaded=false` temporarily even though arrays are present.
      const global = Array.isArray(globalSavedTestCases) ? globalSavedTestCases : [];
      // Merge + dedup by id so local changes are visible even when global snapshot is enabled.
      const byId = new Map();
      global.forEach((t) => {
        if (!t?.id) return;
        byId.set(String(t.id), t);
      });
      local.forEach((t) => {
        if (!t?.id) return;
        byId.set(String(t.id), t);
      });
      return Array.from(byId.values());
    },
    [globalTestCaseDataLoaded, globalSavedTestCases, savedTestCases]
  );
  const fileReferenceTestCaseSets = useMemo(
    () => {
      const local = Array.isArray(savedTestCaseSets) ? savedTestCaseSets : [];
      // Same logic as test cases: merge whenever server arrays exist.
      const global = Array.isArray(globalSavedTestCaseSets) ? globalSavedTestCaseSets : [];
      // Merge + dedup by set id so local changes are visible even when global snapshot is enabled.
      const byId = new Map();
      global.forEach((s) => {
        if (!s?.id) return;
        byId.set(String(s.id), s);
      });
      local.forEach((s) => {
        if (!s?.id) return;
        byId.set(String(s.id), s);
      });
      return Array.from(byId.values());
    },
    [globalTestCaseDataLoaded, globalSavedTestCaseSets, savedTestCaseSets]
  );

  const jobs = useTestStore((s) => s.jobs);
  const boards = useTestStore((s) => s.boards);
  const runBoardSelection = useTestStore((s) => s.runBoardSelection);
  const createJob = useTestStore((s) => s.createJob);
  const refreshFiles = useTestStore((s) => s.refreshFiles);
  const addToast = useTestStore((s) => s.addToast);
  const setLibraryEditContext = useTestStore((s) => s.setLibraryEditContext);
  const clearLibraryEditContext = useTestStore((s) => s.clearLibraryEditContext);
  const setRunSetImportContext = useTestStore((s) => s.setRunSetImportContext);
  const setLoadedSetId = useTestStore((s) => s.setLoadedSetId);
  const syncFullLibraryToSavedTestCases = useTestStore((s) => s.syncFullLibraryToSavedTestCases);
  const libraryFocusFileNameOnNavigate = useTestStore((s) => s.libraryFocusFileNameOnNavigate);
  const clearLibraryFocusFileNameOnNavigate = useTestStore((s) => s.clearLibraryFocusFileNameOnNavigate);
  const fileLibraryViewOnNavigate = useTestStore((s) => s.fileLibraryViewOnNavigate);
  const clearFileLibraryViewOnNavigate = useTestStore((s) => s.clearFileLibraryViewOnNavigate);

  // Status helpers for mapping jobs → sets / test cases / files
  const STATUS_PRIORITY = { completed: 1, pending: 2, running: 3 };
  const normalizeJobStatusForLibrary = (status) => {
    const s = (status || '').toLowerCase();
    if (s === 'running' || s === 'pending') return s;
    if (s === 'completed') return 'completed';
    return null;
  };
  const mergeStatus = (a, b) => {
    if (!a) return b || null;
    if (!b) return a || null;
    return STATUS_PRIORITY[b] > STATUS_PRIORITY[a] ? b : a;
  };

  const { setStatusByName, testCaseStatusByName, fileStatusByName, testCaseStatusByFileKey } = useMemo(() => {
    const setStatus = new Map();
    const tcStatus = new Map();
    const fileStatus = new Map();
    const tcStatusByFileKey = new Map();

    const update = (map, key, rawStatus) => {
      const status = normalizeJobStatusForLibrary(rawStatus);
      if (!key || !status) return;
      const current = map.get(key);
      if (!current || STATUS_PRIORITY[status] > STATUS_PRIORITY[current]) {
        map.set(key, status);
      }
    };

    (jobs || []).forEach((job) => {
      const status = normalizeJobStatusForLibrary(job.status);
      if (!status) return;

      const setName = (job.configName || job.name || '').trim();
      if (setName) update(setStatus, setName, status);

      (job.files || []).forEach((f) => {
        const tcName = (f.testCaseName || '').trim();
        if (tcName) update(tcStatus, tcName, status);

        const v = (f.vcd || f.vcdName || f.name || '').trim().toLowerCase();
        const b = (f.erom || f.binName || '').trim().toLowerCase();
        const l = (f.ulp || f.linName || '').trim().toLowerCase();
        const key = `${v}||${b}||${l}`;
        if (key !== '||||') update(tcStatusByFileKey, key, status);

        if (f.vcd) update(fileStatus, f.vcd, status);
        if (f.erom) update(fileStatus, f.erom, status);
        if (f.ulp) update(fileStatus, f.ulp, status);
        if (f.vcdName) update(fileStatus, f.vcdName, status);
        if (f.binName) update(fileStatus, f.binName, status);
        if (f.linName) update(fileStatus, f.linName, status);
      });
    });

    return {
      setStatusByName: setStatus,
      testCaseStatusByName: tcStatus,
      fileStatusByName: fileStatus,
      testCaseStatusByFileKey: tcStatusByFileKey,
    };
  }, [jobs]);

  const fileNamesInUseByBatch = useMemo(() => {
    const names = new Set();
    fileStatusByName.forEach((status, name) => {
      if (status === 'pending' || status === 'running') {
        names.add(name);
      }
    });
    return names;
  }, [fileStatusByName]);

  useEffect(() => { refreshFiles(); }, [refreshFiles]);
  const fileImportInputRef = useRef(null);
  const inlineFileImportInputRef = useRef(null);
  const [isImportDragging, setIsImportDragging] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importDrafts, setImportDrafts] = useState([]); // [{ id, file, name, tag }]
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);

  useEffect(() => {
    if (importDrafts.length > 0) setIsImportModalOpen(true);
  }, [importDrafts.length]);

  const collectFilesFromDataTransfer = useCallback(async (dt) => {
    try {
      if (!dt) return [];
      const items = Array.from(dt.items || []).filter(Boolean);
      const hasEntry = items.some((it) => typeof it.webkitGetAsEntry === 'function');
      if (!hasEntry) return Array.from(dt.files || []).filter(Boolean);

      const files = [];
      const walkEntry = async (entry, pathPrefix = '') => {
        if (!entry) return;
        if (entry.isFile) {
          const file = await new Promise((resolve) => entry.file(resolve, () => resolve(null)));
          if (!file) return;
          const rel = `${pathPrefix}${file.name}`;
          try {
            Object.defineProperty(file, 'webkitRelativePath', { value: rel, configurable: true });
          } catch {
            // ignore
          }
          files.push(file);
          return;
        }
        if (entry.isDirectory) {
          const reader = entry.createReader();
          const readAll = async () => {
            const batch = await new Promise((resolve) => reader.readEntries(resolve, () => resolve([])));
            if (!batch || batch.length === 0) return [];
            const rest = await readAll();
            return [...batch, ...rest];
          };
          const entries = await readAll();
          for (const child of entries) {
            await walkEntry(child, `${pathPrefix}${entry.name}/`);
          }
        }
      };

      for (const it of items) {
        const entry = it.webkitGetAsEntry?.();
        if (entry) await walkEntry(entry, '');
      }
      return files.filter((f) => f && f.name);
    } catch {
      return Array.from(dt?.files || []).filter(Boolean);
    }
  }, []);

  const enqueueImportDrafts = useCallback((fileList) => {
    const arr = Array.from(fileList || []).filter(Boolean).filter((f) => f?.name);
    if (arr.length === 0) return;
    setImportDrafts((prev) => {
      const existing = new Set(prev.map((d) => `${d.name}::${d.file?.size || 0}`));
      const next = [...prev];
      arr.forEach((file) => {
        const rel = (file.webkitRelativePath && String(file.webkitRelativePath)) || '';
        const base = (rel ? rel.split('/').pop() : String(file.name || '').split('/').pop()) || 'file';
        const key = `${base}::${file.size || 0}`;
        if (existing.has(key)) return;
        existing.add(key);
        next.push({
          id: `imp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          file,
          name: base,
          tag: '',
        });
      });
      return next;
    });
  }, []);

  const saveImportDraftsToLibrary = useCallback(async () => {
    if (importDrafts.length === 0) return;
    setIsImporting(true);
    let ok = 0;
    let dup = 0;
    const normSize = (v) => {
      const n = typeof v === 'number' ? v : Number(String(v || '').replace(/[^\d.]/g, ''));
      return Number.isFinite(n) ? n : null;
    };
    const base = (s) => (String(s || '').split('/').pop() || String(s || '')).trim();
    const existingKeys = new Set(
      (uploadedFiles || []).map((f) => `${base(f.name)}::${normSize(f.size) ?? ''}`)
    );
    for (const d of importDrafts) {
      const rawName = String(d.name || '').trim();
      if (!d.file || !rawName) continue;
      const desiredKey = `${base(rawName)}::${normSize(d.file.size) ?? ''}`;
      if (existingKeys.has(desiredKey)) {
        dup++;
        continue;
      }
      const renamed = rawName === d.file.name ? d.file : new File([d.file], rawName, { type: d.file.type });
      // attach metadata for backend upload
      renamed.metadata = { tag: (d.tag || '').trim() };
      const result = await addUploadedFile(renamed);
      if (result?.id) {
        ok++;
        existingKeys.add(desiredKey);
        const tagVal = (d.tag || '').trim();
        if (tagVal) setFileTag?.(result.id, tagVal);
      }
    }
    setIsImporting(false);
    setImportDrafts([]);
    setIsImportModalOpen(false);
    if (ok > 0) addToast({ type: 'success', message: `Saved ${ok} file(s) to Library` });
    if (dup > 0) addToast({ type: 'info', message: `Skipped ${dup} duplicate file(s) (already in Library)` });
    if (ok === 0 && dup === 0) addToast({ type: 'warning', message: 'No file saved' });
  }, [importDrafts, uploadedFiles, addUploadedFile, addToast, setFileTag]);

  const saveImportDraftsToLibraryAndSendToRunSet = useCallback(async () => {
    await saveImportDraftsToLibrary();
    if (onNavigateToRunSet) onNavigateToRunSet();
  }, [saveImportDraftsToLibrary, onNavigateToRunSet]);
  const [libraryView, setLibraryView] = useState('files'); // 'files' | 'rawTestCases' | 'testCases'
  useEffect(() => {
    if (!fileLibraryViewOnNavigate) return;
    setLibraryView(fileLibraryViewOnNavigate);
    clearFileLibraryViewOnNavigate();
  }, [fileLibraryViewOnNavigate, clearFileLibraryViewOnNavigate]);
  const [fileFilter, setFileFilter] = useState('all');
  const [fileStatusFilter, setFileStatusFilter] = useState('all'); // 'all' | 'pending' | 'running' | 'completed'
  const [fileSearch, setFileSearch] = useState('');
  const [fileTagSearch, setFileTagSearch] = useState('');
  const [fileSizeSearch, setFileSizeSearch] = useState('');
  const [fileOwnerSearch, setFileOwnerSearch] = useState('');
  const [tagInputByFileId, setTagInputByFileId] = useState({});
  const [isTagEditorOpenByFileId, setIsTagEditorOpenByFileId] = useState({});
  const [editingDisplayNameFileId, setEditingDisplayNameFileId] = useState(null);
  const [renameDraft, setRenameDraft] = useState('');
  const skipRenameCommitRef = useRef(false);
  const [showAllTagsForFileId, setShowAllTagsForFileId] = useState(null);
  const [fileTagsModalEditIndex, setFileTagsModalEditIndex] = useState(null);
  const [fileTagsModalEditDraft, setFileTagsModalEditDraft] = useState('');
  const [fileTagsModalAddDraft, setFileTagsModalAddDraft] = useState('');
  const [fileTagsModalAddOpen, setFileTagsModalAddOpen] = useState(false);
  const [importTagHistoryOpenId, setImportTagHistoryOpenId] = useState(null);
  /** Ellipsis on TC chips — was wrongly opening Tags modal; use file name to list test cases */
  const [showAllUsedByTcForFileName, setShowAllUsedByTcForFileName] = useState(null);
  const [showAllSetsForFileName, setShowAllSetsForFileName] = useState(null);
  const [bulkTagInput, setBulkTagInput] = useState('');
  const [fileSort, setFileSort] = useState('time');
  const [fileViewMode, setFileViewMode] = useState('all'); // 'all' | 'bySet'
  const [isDeleting, setIsDeleting] = useState(false);
  const [deletingBoxId, setDeletingBoxId] = useState(null);
  const [libraryTcNameFilter, setLibraryTcNameFilter] = useState('');
  const [libraryTcTagFilter, setLibraryTcTagFilter] = useState('');
  const [libraryTcStatusFilter, setLibraryTcStatusFilter] = useState('all'); // 'all' | 'pending' | 'running' | 'completed'
  const [selectedLibraryTcKeys, setSelectedLibraryTcKeys] = useState([]);
  /** Raw Test Cases: inline editor — key = row _key */
  const [rawTcEditorKey, setRawTcEditorKey] = useState(null);
  const [rawTcEditorDraft, setRawTcEditorDraft] = useState(null);
  // 'edit' = modify existing row; 'duplicate' = force "save as new" flow (used for running/pending)
  const [rawTcEditorMode, setRawTcEditorMode] = useState('edit'); // 'edit' | 'duplicate'
  const [rawTcEditorSourceRow, setRawTcEditorSourceRow] = useState(null);
  const [addTcsToSetModalSetId, setAddTcsToSetModalSetId] = useState(null);
  const [addTcsToSetSelectedIds, setAddTcsToSetSelectedIds] = useState([]);
  const [addTcsPickerNameQ, setAddTcsPickerNameQ] = useState('');
  const [addTcsPickerTagQ, setAddTcsPickerTagQ] = useState('');
  const [addTcsPickerOwnerQ, setAddTcsPickerOwnerQ] = useState('');
  const [addTcsPickerTimeQ, setAddTcsPickerTimeQ] = useState('');
  const [rawTcFilePicker, setRawTcFilePicker] = useState(null); // { kind: 'bin'|'vcd'|'lin', q: string } | null
  /** Edit TC panel: … opens tag color tools (same picker as TC column Tags modal). */
  const [rawTcEditorTagToolsOpen, setRawTcEditorTagToolsOpen] = useState(false);
  const rawTcEditorTagToolsRef = useRef(null);
  /** Raw Test Cases table: tag overflow modal + inline + (same UX as Test Cases page) */
  const [libraryRawTcTagOverflowKey, setLibraryRawTcTagOverflowKey] = useState(null);
  const [libraryRawTcTagModalAddDraft, setLibraryRawTcTagModalAddDraft] = useState('');
  const [libraryRawTcTagModalEditIndex, setLibraryRawTcTagModalEditIndex] = useState(null);
  const [libraryRawTcTagModalEditDraft, setLibraryRawTcTagModalEditDraft] = useState('');
  const [libraryRawTcTagPlusKey, setLibraryRawTcTagPlusKey] = useState(null);
  const [libraryRawTcTagPlusDraft, setLibraryRawTcTagPlusDraft] = useState('');
  const [libraryRawTcTagHistoryOpenKey, setLibraryRawTcTagHistoryOpenKey] = useState(null);
  const lastClickedLibraryTcIndexRef = useRef(null);
  const isDragSelectingLibraryRef = useRef(false);
  const [librarySetTcNameFilter, setLibrarySetTcNameFilter] = useState('');
  const [librarySetTcTagFilter, setLibrarySetTcTagFilter] = useState('');
  const [librarySetTcStatusFilter, setLibrarySetTcStatusFilter] = useState('all'); // 'all' | 'pending' | 'running' | 'completed'
  const [selectedLibrarySetTcKeys, setSelectedLibrarySetTcKeys] = useState([]);
  const lastClickedLibrarySetTcRef = useRef({ setId: null, index: null });
  const isDragSelectingLibrarySetRef = useRef(false);
  const isDragSelectingAddTcPickerRef = useRef(false);
  const [selectedLibraryFileIds, setSelectedLibraryFileIds] = useState([]);
  const lastClickedFileIndexRef = useRef(null);
  const isDragSelectingFileRef = useRef(false);
  const [libraryFocusFileName, setLibraryFocusFileName] = useState(null);
  const focusedLibraryFileRef = useRef(null);
  // Separate filter per Library tab: Set=Mine, Test Cases=Mine, File=All
  const [librarySetFilter, setLibrarySetFilter] = useState('mine'); // Set Library
  const [libraryTestCasesFilter, setLibraryTestCasesFilter] = useState('mine'); // Test Cases Library
  const [libraryFileFilter, setLibraryFileFilter] = useState('all'); // File in Library
  const libraryCreatedByFilter = libraryView === 'testCases' ? librarySetFilter : libraryView === 'rawTestCases' ? libraryTestCasesFilter : libraryFileFilter;
  const setLibraryCreatedByFilter = (value) => {
    if (libraryView === 'testCases') setLibrarySetFilter(value);
    else if (libraryView === 'rawTestCases') setLibraryTestCasesFilter(value);
    else setLibraryFileFilter(value);
  };
  const refreshGlobalTestCaseData = useTestStore((s) => s.refreshGlobalTestCaseData);

  // "All" / "Shared" = aggregate from GET /profiles/all-test-cases — fetch when that filter is active and snapshot not ready (otherwise we only saw active profile's savedTestCases)
  useEffect(() => {
    if (libraryView !== 'rawTestCases' && libraryView !== 'testCases') return;
    if (libraryCreatedByFilter === 'mine') return;
    if (globalTestCaseDataLoaded) return;
    void refreshGlobalTestCaseData();
  }, [libraryView, libraryCreatedByFilter, globalTestCaseDataLoaded, refreshGlobalTestCaseData]);

  const fileVisById = useTestStore((s) => s.fileVisById);
  const setFileVisById = useTestStore((s) => s.setFileVisById);
  const filePendingById = useTestStore((s) => s.filePendingById);
  const testCasePendingById = useTestStore((s) => s.testCasePendingById);
  const savedTestCaseSetPendingById = useTestStore((s) => s.savedTestCaseSetPendingById);
  const fileTagsModalPendingBusy = !!(showAllTagsForFileId && filePendingById?.[showAllTagsForFileId]);
  const selectedFilesPending = selectedLibraryFileIds.some((id) => filePendingById?.[id]);

  const getFileKind = (f) => {
    const ext = String(f?.name || '').split('.').pop()?.toLowerCase();
    if (ext === 'vcd') return 'vcd';
    if (['bin', 'hex', 'elf', 'erom'].includes(ext)) return 'bin';
    // Text-based MDI files (manual commands / scripts)
    if (ext === 'txt') return 'mdi';
    if (['lin', 'ulp'].includes(ext)) return 'lin';
    return 'other';
  };

  const splitTags = (raw) =>
    String(raw || '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

  // Global tag history for files (per-profile, but scoped only to file tags).
  const fileTagHistory = useMemo(() => {
    const acc = [];
    const tagsMap = fileTags || {};
    Object.values(tagsMap).forEach((raw) => {
      splitTags(raw).forEach((t) => acc.push(t));
    });
    // Include tags from import drafts so recently typed values appear quickly.
    (importDrafts || []).forEach((d) => {
      if (!d || !d.tag) return;
      splitTags(d.tag).forEach((t) => acc.push(t));
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
  }, [fileTags, importDrafts]);

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
    const profileMap = map?.[pid] && typeof map[pid] === 'object' ? map[pid] : {};
    const existing = Array.isArray(profileMap[ek]) ? profileMap[ek] : [];
    const existingSet = new Set(existing.map((t) => String(t).toLowerCase()));

    let changed = false;
    for (const t of addedTags) {
      const lt = String(t || '').trim().toLowerCase();
      if (!lt || existingSet.has(lt)) continue;
      existingSet.add(lt);
      existing.push(lt);
      changed = true;
    }

    if (!changed) return;
    profileMap[ek] = existing;
    map[pid] = profileMap;
    saveMyTagOrderMap(map);
  };

  const reorderTagsForDisplayWithIndices = (profileId, entityKey, tags, colorList) => {
    const pid = String(profileId || 'default');
    const ek = String(entityKey || '');
    if (!ek || !Array.isArray(tags) || tags.length === 0) {
      return { orderedTags: tags || [], orderedColorList: Array.isArray(colorList) ? colorList || [] : [], orderedOriginalIndices: [] };
    }

    const map = loadMyTagOrderMap();
    const savedList = map?.[pid]?.[ek];
    const myList = Array.isArray(savedList) ? savedList : [];
    if (myList.length === 0) {
      const orderedOriginalIndices = tags.map((_, i) => i);
      return {
        orderedTags: tags,
        orderedColorList: Array.isArray(colorList) ? colorList : [],
        orderedOriginalIndices,
      };
    }

    const mySet = new Set(myList.map((t) => String(t).toLowerCase()));
    const indexed = tags.map((t, i) => ({ t, i, lt: String(t).toLowerCase() }));
    const inMy = indexed.filter((x) => mySet.has(x.lt));
    if (inMy.length === 0) {
      const orderedOriginalIndices = tags.map((_, i) => i);
      return {
        orderedTags: tags,
        orderedColorList: Array.isArray(colorList) ? colorList : [],
        orderedOriginalIndices,
      };
    }

    const notMy = indexed.filter((x) => !mySet.has(x.lt));
    // Personalized view: show tags I added first (others keep default order).
    const ordered = [...inMy, ...notMy];
    return {
      orderedTags: ordered.map((x) => x.t),
      orderedColorList: Array.isArray(colorList) ? ordered.map((x) => colorList[x.i]) : [],
      orderedOriginalIndices: ordered.map((x) => x.i),
    };
  };

  const getTcEntityKey = (tc) => {
    if (!tc) return 'tc:unknown';
    if (tc.id != null) return `tc:${tc.id}`;
    if (tc._source === 'set' && tc._setId != null && tc._itemIndex != null) return `tc:setItem:${tc._setId}:${tc._itemIndex}`;
    // fallback for drafts / temporary rows
    return `tc:${tc._source || 'unknown'}:${tc._setId || ''}:${tc._itemIndex || ''}:${tc._key || ''}`;
  };

  /** Enter ระหว่าง IME (CJK/ไทย) ไม่ควร commit tag — มิฉะนั้นจะไม่เพิ่ม tag */
  const tagEnterShouldIgnoreIme = (e) =>
    e.key === 'Enter' && (e.nativeEvent?.isComposing === true || e.keyCode === 229);

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

  const normalizeFileSize = (value) => {
    if (typeof value === 'number') return value;
    if (value == null) return 0;
    const n = Number(String(value).replace(/[^\d.]/g, ''));
    return Number.isFinite(n) ? n : 0;
  };

  const filteredFiles = [...(uploadedFiles || [])]
    .filter((f) => {
      const k = getFileKind(f);
      if (fileFilter !== 'all') {
        if (fileFilter === 'vcd' && k !== 'vcd') return false;
        if (fileFilter === 'bin' && k !== 'bin') return false;
        if (fileFilter === 'lin' && k !== 'lin') return false;
        if (fileFilter === 'mdi' && k !== 'mdi') return false;
      }
      const status = fileStatusByName.get(f.name) || null;
      if (fileStatusFilter !== 'all') {
        if (!status) return false;
        if (fileStatusFilter !== status) return false;
      }
      if (fileSearch.trim() && !String(f.name || '').toLowerCase().includes(fileSearch.trim().toLowerCase())) return false;
      if (fileTagSearch.trim()) {
        const tags = splitTags((fileTags && fileTags[f.id]) || '');
        const q = fileTagSearch.trim().toLowerCase();
        if (!tags.some((t) => t.toLowerCase().includes(q))) return false;
      }
      if (fileSizeSearch.trim()) {
        const q = fileSizeSearch.trim().toLowerCase();
        const n = normalizeFileSize(f.size);
        const sizeTxt = String(f.sizeFormatted || f.size || '').toLowerCase();
        if (!sizeTxt.includes(q) && !String(n).includes(q)) return false;
      }
      if (fileOwnerSearch.trim()) {
        const q = fileOwnerSearch.trim().toLowerCase();
        const display = resolveFileOwnerDisplay(f, ownerLabelCtx).toLowerCase();
        const ownerId = String(f.ownerId || '').toLowerCase();
        if (!display.includes(q) && !ownerId.includes(q)) return false;
      }
      if (libraryCreatedByFilter === 'mine') {
        if (!isFileOwnerMine(f, currentClientId, activeProfileId)) return false;
        return true;
      }
      if (libraryCreatedByFilter === 'shared') {
        if (!isFileOwnerOtherUser(f, currentClientId, activeProfileId)) return false;
        return true;
      }
      return true;
    })
    .sort((a, b) => {
      if (fileSort !== 'time') return (a.name || '').localeCompare(b.name || '');
      const ta = new Date(a.updatedAt || a.uploadDate || 0).getTime();
      const tb = new Date(b.updatedAt || b.uploadDate || 0).getTime();
      return tb - ta;
    });

  // ชื่อไฟล์ที่ Set ใช้ (จาก snapshot หรือ items)
  const getFileNamesForSet = (set) => {
    const names = new Set();
    (set.fileLibrarySnapshot || []).forEach((s) => s.name && names.add(s.name));
    (set.items || []).forEach((t) => {
      if (t.vcdName) names.add(t.vcdName);
      if (t.binName) names.add(t.binName);
      if (t.linName) names.add(t.linName);
    });
    return [...names];
  };
  const getTestCaseStatusFromJobs = useCallback(
    (tc) => {
      if (!tc) return null;
      const v = (tc.vcdName || '').trim().toLowerCase();
      const b = (tc.binName || '').trim().toLowerCase();
      const l = (tc.linName || '').trim().toLowerCase();
      const fileKey = `${v}||${b}||${l}`;
      if (fileKey !== '||||') {
        if (testCaseStatusByFileKey.has(fileKey)) {
          return testCaseStatusByFileKey.get(fileKey);
        }
        return null;
      }
      const name = (tc.name || '').trim();
      if (name && testCaseStatusByName.has(name)) {
        return testCaseStatusByName.get(name);
      }
      return null;
    },
    [testCaseStatusByName, testCaseStatusByFileKey]
  );

  // Test case history: jobs/sets where this test case (vcd+erom+ulp or testCaseName) was used
  const getTestCaseHistory = useCallback((tc) => {
    if (!tc || !jobs?.length) return [];
    const vcd = (tc.vcdName || '').trim().toLowerCase();
    const erom = (tc.binName || '').trim().toLowerCase();
    const lin = (tc.linName || '').trim().toLowerCase();
    const tcName = (tc.name || '').trim();
    if (!vcd && !erom && !tcName) return [];
    const out = [];
    const seen = new Set();
    jobs.forEach((job) => {
      (job.files || []).forEach((f, fileIndex) => {
        const key = `${job.id}-${fileIndex}`;
        if (seen.has(key)) return;
        const fVcd = (f.vcd || f.name || '').trim().toLowerCase();
        const fErom = (f.erom || '').trim().toLowerCase();
        const fUlp = (f.ulp || '').trim().toLowerCase();
        const fTcName = (f.testCaseName || '').trim();
        const matchByFiles = (fVcd === vcd && fErom === erom && fUlp === lin);
        const matchByNameAndVcd = tcName && fTcName === tcName && (!vcd || fVcd === vcd);
        if (matchByFiles || matchByNameAndVcd) {
          seen.add(key);
          out.push({ job, fileIndex });
        }
      });
    });
    return out;
  }, [jobs]);

  const [testCaseHistoryFor, setTestCaseHistoryFor] = useState(null);

  const filesBySet =
    fileViewMode === 'bySet'
      ? (fileReferenceTestCaseSets || []).map((set) => ({
          set,
          files: filteredFiles.filter((f) => getFileNamesForSet(set).includes(f.name)),
        }))
      : [];

  const focusFileInLibrary = (rawName) => {
    const fileName = typeof rawName === 'string' ? rawName.trim() : '';
    if (!fileName) return;

    setLibraryView('files');
    setFileViewMode('all');
    setFileFilter('all');
    setFileSearch('');
    setLibraryFocusFileName(fileName);

    const match = (uploadedFiles || []).find((f) => f.name === fileName);
    if (match?.id) {
      setSelectedLibraryFileIds([match.id]);
    } else {
      setSelectedLibraryFileIds([]);
      addToast({ type: 'info', message: `File "${fileName}" is not in File in Library yet. Upload it on the Test Cases page first.` });
    }
  };

  // When navigating from JobsPage (or other) with a file to focus
  useEffect(() => {
    if (!libraryFocusFileNameOnNavigate) return;
    const fileName = libraryFocusFileNameOnNavigate;
    clearLibraryFocusFileNameOnNavigate();
    setLibraryView('files');
    setFileViewMode('all');
    setFileFilter('all');
    setFileSearch('');
    setLibraryFocusFileName(fileName);
    const match = (uploadedFiles || []).find((f) => f.name === fileName);
    if (match?.id) {
      setSelectedLibraryFileIds([match.id]);
    } else {
      setSelectedLibraryFileIds([]);
      addToast({ type: 'info', message: `File "${fileName}" is not in File in Library yet. Upload it on the Test Cases page first.` });
    }
  }, [libraryFocusFileNameOnNavigate]);

  useEffect(() => {
    if (libraryView !== 'files') return;
    if (!libraryFocusFileName) return;
    const el = focusedLibraryFileRef.current;
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [libraryView, libraryFocusFileName, filteredFiles.length]);

  const libraryRawRows = useMemo(() => {
    if (libraryView !== 'rawTestCases') return [];
    const withMdi = (tc) => {
      const cmds = Array.isArray(tc.commands) ? tc.commands : [];
      const names = [];
      cmds
        .filter((c) => c && c.type === 'mdi' && String(c.file || '').trim())
        .forEach((c) => names.push(String(c.file).trim()));
      const ex = tc.extraColumns && typeof tc.extraColumns === 'object' ? tc.extraColumns : {};
      const mdiKeys = Object.keys(ex).filter((k) => /^MDI\d+$/i.test(k));
      mdiKeys
        .sort((a, b) => {
          const na = parseInt(String(a).match(/\d+/)?.[0] || '0', 10);
          const nb = parseInt(String(b).match(/\d+/)?.[0] || '0', 10);
          return na - nb;
        })
        .forEach((k) => {
          const v = String(ex[k] || '').trim();
          if (v && !names.includes(v)) names.push(v);
        });
      if (!names.length) return tc;
      return { ...tc, mdiNames: names };
    };
    const contentKey = (tc) => [
      tc.name ?? '',
      tc.vcdName ?? '',
      tc.binName ?? '',
      tc.linName ?? '',
    ].join('\0');
    const withStatus = (tc) => ({
      ...withMdi(tc),
      _status: getTestCaseStatusFromJobs(tc),
    });

    const needsGlobal = libraryCreatedByFilter !== 'mine';
    const mineOwnerDisplay = resolveOwnerDisplayName(activeProfileId, ownerLabelCtx);

    // All / Shared: always merge server snapshot + every profile’s localStorage (never empty while global loads).
    // Mine: current profile only — owner label matches file owner resolution (server directory + local profiles).
    const sourceCases = needsGlobal
      ? aggregateSavedTestCasesAcrossProfiles()
      : (savedTestCases || []).map((tc) => ({
          ...tc,
          _ownerId: activeProfileId,
          _ownerName: mineOwnerDisplay,
        }));

    const sourceSets = needsGlobal
      ? aggregateSavedTestCaseSetsAcrossProfiles()
      : (savedTestCaseSets || []).map((set) => ({
          ...set,
          _ownerId: activeProfileId,
          _ownerName: mineOwnerDisplay,
        }));

    const fromCurrent = sourceCases.map((tc) =>
      withStatus({
        ...tc,
        _key: `current-${tc.id || `${tc._ownerId || 'unknown'}-${tc.name || ''}`}`,
        _source: 'current',
        _ownerId: tc._ownerId ?? activeProfileId,
        _owner: resolveOwnerDisplayName(tc._ownerId ?? activeProfileId, ownerLabelCtx),
      })
    );
    const seen = new Set(fromCurrent.map((tc) => contentKey(tc)));
    const fromSets = (sourceSets || []).flatMap((set) =>
      (Array.isArray(set.items) ? set.items : []).map((tc, tcIdx) =>
        withStatus({
          ...tc,
          _key: `set-${set.id}-${tcIdx}`,
          _source: 'set',
          _setId: set.id,
          _itemIndex: tcIdx,
          _ownerId: set._ownerId ?? activeProfileId,
          _owner: resolveOwnerDisplayName(set._ownerId ?? activeProfileId, ownerLabelCtx),
        })
      )
    );
    const fromSetsDeduped = fromSets.filter((tc) => {
      const key = contentKey(tc);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return [...fromCurrent, ...fromSetsDeduped];
  }, [
    libraryView,
    savedTestCases,
    savedTestCaseSets,
    getTestCaseStatusFromJobs,
    activeProfile,
    activeProfileId,
    libraryCreatedByFilter,
    globalSavedTestCases,
    globalSavedTestCaseSets,
    globalTestCaseDataLoaded,
    profiles,
    ownerLabelCtx,
    aggregateSavedTestCasesAcrossProfiles,
    aggregateSavedTestCaseSetsAcrossProfiles,
  ]);

  const libraryFilteredRows = useMemo(() => {
    return libraryRawRows.filter((tc) => {
      if (libraryTcNameFilter.trim() && !(tc.name || '').toLowerCase().includes(libraryTcNameFilter.trim().toLowerCase())) return false;
      const tagVal = (tc.extraColumns && (tc.extraColumns.tag || tc.extraColumns.Tag)) || '';
      if (libraryTcTagFilter.trim() && !String(tagVal).toLowerCase().includes(libraryTcTagFilter.trim().toLowerCase())) return false;
      if (libraryTcStatusFilter !== 'all') {
        const status = tc._status || null;
        if (!status) return false;
        if (libraryTcStatusFilter !== status) return false;
      }
      if (libraryCreatedByFilter === 'mine' && tc._ownerId !== activeProfileId) return false;
      if (libraryCreatedByFilter === 'shared' && (tc._ownerId === activeProfileId || !tc._ownerId)) return false;
      return true;
    });
  }, [libraryRawRows, libraryTcNameFilter, libraryTcTagFilter, libraryTcStatusFilter, libraryCreatedByFilter, activeProfileId]);

  const fileOptionsByKind = useMemo(() => {
    const list = uploadedFiles || [];
    const by = { vcd: [], bin: [], lin: [], mdi: [] };
    const kindOf = (name) => {
      const ext = String(name || '').split('.').pop()?.toLowerCase();
      if (ext === 'vcd') return 'vcd';
      if (['bin', 'hex', 'elf', 'erom'].includes(ext)) return 'bin';
      if (['lin', 'ulp'].includes(ext)) return 'lin';
      if (ext === 'txt') return 'mdi';
      return null;
    };
    list.forEach((f) => {
      const k = kindOf(f.name);
      if (k && by[k]) by[k].push(f.name);
    });
    return by;
  }, [uploadedFiles]);

  const mergeCommandsIntoExtraForTc = useCallback((tc) => {
    const extra = tc.extraColumns && typeof tc.extraColumns === 'object' ? { ...tc.extraColumns } : {};
    const cmds = Array.isArray(tc.commands) ? tc.commands : [];
    cmds.filter((c) => c.type === 'vcd' && (c.file || '').trim()).forEach((c, i) => {
      extra[`VCD${i + 2}`] = c.file || '';
    });
    cmds.filter((c) => c.type === 'erom' && (c.file || '').trim()).forEach((c, i) => {
      extra[`ERoM${i + 2}`] = c.file || '';
    });
    cmds.filter((c) => c.type === 'ulp' && (c.file || '').trim()).forEach((c, i) => {
      extra[`ULP${i + 2}`] = c.file || '';
    });
    return Object.fromEntries(Object.entries(extra).filter(([, v]) => (v ?? '').toString().trim() !== ''));
  }, []);

  const patchLibraryTcExtraColumns = useCallback(
    (tc, patch) => {
      const nextExtra = { ...(tc.extraColumns || {}), ...patch };
      if (Object.prototype.hasOwnProperty.call(patch, 'tag')) delete nextExtra.Tag;
      if (Object.prototype.hasOwnProperty.call(patch, 'tag')) {
        // Track tags we add ourselves (for tag chip ordering).
        const prevRaw = (tc?.extraColumns && (tc.extraColumns.tag || tc.extraColumns.Tag)) || '';
        const nextRaw = String(patch.tag ?? '');
        const prevLower = new Set(splitTags(prevRaw).map((t) => String(t).toLowerCase()));
        const added = splitTags(nextRaw).filter((t) => !prevLower.has(String(t).toLowerCase()));
        if (added.length) recordMyAddedTagsForEntity(activeProfileId, getTcEntityKey(tc), added);

        syncTagColorListAfterTagChange(nextExtra, String(patch.tag ?? ''));
      }

      if (tc._ownerId != null && tc._ownerId !== activeProfileId) {
        addToast({
          type: 'warning',
          message: 'แก้ไข tag ได้เฉพาะเทสต์เคสของโปรไฟล์คุณ',
        });
        return;
      }

      if (tc._source === 'current' && tc.id) {
        const hasLocal = (savedTestCases || []).some((t) => String(t.id) === String(tc.id));
        if (!hasLocal) {
          addToast({
            type: 'warning',
            message: 'ไม่พบเทสต์เคสในโปรไฟล์นี้ — ไม่สามารถบันทึก tag ได้ (ลองรีเฟรชหน้า)',
          });
          return;
        }
        updateSavedTestCase(tc.id, { extraColumns: nextExtra });
        return;
      }
      if (tc._source === 'set' && tc._setId != null && tc._itemIndex != null) {
        const set = (savedTestCaseSets || []).find((s) => String(s.id) === String(tc._setId));
        if (!set || !Array.isArray(set.items)) {
          addToast({
            type: 'warning',
            message: 'ไม่พบชุดเทสต์เคสในโปรไฟล์นี้ — ไม่สามารถบันทึก tag ได้',
          });
          return;
        }
        const items = [...set.items];
        if (!items[tc._itemIndex]) {
          addToast({
            type: 'warning',
            message: 'ไม่พบรายการในเซ็ต — ไม่สามารถบันทึก tag ได้',
          });
          return;
        }
        items[tc._itemIndex] = {
          ...items[tc._itemIndex],
          extraColumns: nextExtra,
        };
        updateSavedTestCaseSet(tc._setId, { items });
      }
    },
    [
      activeProfileId,
      addToast,
      savedTestCases,
      savedTestCaseSets,
      updateSavedTestCase,
      updateSavedTestCaseSet,
    ]
  );

  const collectFileNamesFromTestCase = useCallback((tc) => {
    const names = new Set();
    const add = (n) => {
      const s = (n ?? '').toString().trim();
      if (s) names.add(s);
    };
    add(tc.vcdName);
    add(tc.binName);
    add(tc.linName);
    (tc.commands || []).forEach((c) => {
      if (c?.file) add(c.file);
    });
    const ex = tc.extraColumns || {};
    Object.keys(ex).forEach((k) => {
      if (/^(VCD|ERoM|ULP)\d+$/i.test(k)) add(ex[k]);
    });
    return [...names];
  }, []);

  const buildRawTcDraft = useCallback((tc) => {
    const ex = tc.extraColumns && typeof tc.extraColumns === 'object' ? tc.extraColumns : {};
    const tag =
      (ex.tag || ex.Tag) != null
        ? String(ex.tag || ex.Tag)
        : '';
    const tagTrim = tag.trim();
    const tags = String(tagTrim || '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    const tagColorList = tags.length ? normalizeTagColorList(ex, tags.length) : [];
    const fbRaw = (ex.tagColor || ex.tag_color) && TAG_PALETTE_MAP[ex.tagColor || ex.tag_color]
      ? ex.tagColor || ex.tag_color
      : tags.length
        ? tagColorList[0]
        : 'mint';
    const tagColor = TAG_PALETTE_MAP[fbRaw] ? fbRaw : 'mint';
    return {
      name: (tc.name || '').trim(),
      tag: tagTrim,
      tryCount: typeof tc.tryCount === 'number' && tc.tryCount > 0 ? tc.tryCount : 1,
      vcdName: (tc.vcdName || '').trim(),
      binName: (tc.binName || '').trim(),
      linName: (tc.linName || '').trim(),
      extraSlots: collectExtraSlotsFromTc(tc),
      tagColor,
      tagColorList: tags.length ? [...tagColorList] : [],
    };
  }, []);

  const canEditRawTcRow = useCallback(
    (row) => {
      if (!row) return false;
      if (row._status === 'running' || row._status === 'pending') return false;
      if (row._ownerId != null && row._ownerId !== activeProfileId) return false;
      return true;
    },
    [activeProfileId]
  );

  const openRawTcEditor = useCallback(
    (tc) => {
      if (!canEditRawTcRow(tc)) {
        addToast({
          type: 'warning',
          message:
            tc._ownerId != null && tc._ownerId !== activeProfileId
              ? 'แก้ได้เฉพาะเทสต์เคสในโปรไฟล์ของคุณ'
              : 'เทสต์เคสกำลัง Running/Pending — แก้ไม่ได้จนกว่า process จะจบ',
        });
        return;
      }
      setRawTcEditorKey(tc._key);
      setRawTcEditorDraft(buildRawTcDraft(tc));
      setRawTcEditorMode('edit');
      setRawTcEditorSourceRow(null);
    },
    [activeProfileId, addToast, buildRawTcDraft, canEditRawTcRow]
  );

  const openRawTcDuplicateEditor = useCallback(
    (row) => {
      if (!row) return;
      setRawTcEditorKey(row._key);
      setRawTcEditorDraft(buildRawTcDraft(row));
      setRawTcEditorMode('duplicate');
      setRawTcEditorSourceRow(row);
    },
    [buildRawTcDraft]
  );

  const isFileManuallyClosed = useCallback(
    (file) => {
      const vis = String(fileVisById?.[file?.id] || file?.visibility || 'open').toLowerCase();
      return vis === 'close' || vis === 'closed' || vis === 'lock' || vis === 'locked' || vis === 'private';
    },
    [fileVisById]
  );

  const updateTcVisibility = useCallback(
    (row, isClosed) => {
      const visVal = isClosed ? 'close' : 'open';
      const nextExtra = { ...(row.extraColumns || {}), vis: visVal };
      if (row._source === 'current' && row.id) {
        updateSavedTestCase(row.id, { extraColumns: nextExtra });
        return;
      }
      if (row._source === 'set' && row._setId != null && row._itemIndex != null) {
        const set = (savedTestCaseSets || []).find((s) => s.id === row._setId);
        if (!set || !Array.isArray(set.items) || !set.items[row._itemIndex]) return;
        const items = [...set.items];
        items[row._itemIndex] = {
          ...items[row._itemIndex],
          extraColumns: nextExtra,
        };
        updateSavedTestCaseSet(row._setId, { items });
      }
    },
    [savedTestCaseSets, updateSavedTestCase, updateSavedTestCaseSet]
  );

  const runSavedSetNow = useCallback(
    async (set) => {
      const setName = (set?.name || '').trim() || 'Set';
      const items = Array.isArray(set?.items) ? set.items : [];
      if (items.length === 0) {
        addToast({ type: 'warning', message: 'Set นี้ไม่มี test case ให้รัน' });
        return;
      }
      const mode = runBoardSelection?.mode || 'auto';
      const boardIds = Array.isArray(runBoardSelection?.boardIds) ? runBoardSelection.boardIds : [];
      if (mode === 'manual' && boardIds.length === 0) {
        addToast({ type: 'warning', message: 'ไม่มีบอร์ดที่เลือกไว้ (manual) — ไปที่ Run Set เพื่อเลือกบอร์ดก่อน' });
        return;
      }
      const boardNames =
        mode === 'auto'
          ? []
          : (boards || [])
              .filter((b) => boardIds.includes(b.id))
              .map((b) => b.name)
              .filter(Boolean);

      const libFiles = Array.isArray(uploadedFiles) ? uploadedFiles : [];
      // Match by normalized filename to avoid false "not found" due to case/whitespace.
      const libByName = new Map(
        libFiles.map((f) => [String(f?.name || '').trim().toLowerCase(), f]).filter(([k]) => k)
      );
      const missingNames = new Set();
      const filesPayload = [];
      let firstBinName = '';
      const pairsData = [];
      items.forEach((tc, idx) => {
        const vcdKey = String(tc?.vcdName || '').trim().toLowerCase();
        const eromKey = String(tc?.binName || '').trim().toLowerCase();
        const ulpKey = tc?.linName ? String(tc?.linName || '').trim().toLowerCase() : '';
        const vcd = vcdKey ? libByName.get(vcdKey) : null;
        const erom = eromKey ? libByName.get(eromKey) : null;
        const ulp = ulpKey ? libByName.get(ulpKey) : null;
        if (!vcd || !erom) {
          if (tc?.vcdName && !vcd) missingNames.add(String(tc.vcdName).trim());
          if (tc?.binName && !erom) missingNames.add(String(tc.binName).trim());
          return;
        }
        if (!firstBinName) firstBinName = erom.name;
        filesPayload.push({
          name: vcd.name,
          order: filesPayload.length + 1,
          vcd: vcd.name,
          erom: erom.name,
          ulp: ulp?.name || null,
          try_count: typeof tc.tryCount === 'number' && tc.tryCount > 0 ? tc.tryCount : 1,
          testCaseName: (tc.name || '').trim() || `Test case ${idx + 1}`,
        });
        pairsData.push({
          vcdId: vcd.id,
          binId: erom.id,
          linId: ulp?.id || null,
          vcdName: tc.vcdName || '',
          binName: tc.binName || '',
          linName: tc.linName || null,
          try: typeof tc.tryCount === 'number' && tc.tryCount > 0 ? tc.tryCount : 1,
          boardId: tc.boardId || null,
          boardName: tc.boardId ? (boards || []).find((b) => b.id === tc.boardId)?.name : null,
          testCaseName: (tc.name || '').trim() || `Test case ${idx + 1}`,
        });
      });

      if (filesPayload.length === 0) {
        const miss = [...missingNames];
        if (miss.length > 0) {
          addToast({
            type: 'error',
            message: `Run ไม่ได้ — ไฟล์ไม่ครบใน Library: ${miss.slice(0, 5).join(', ')}${miss.length > 5 ? ` +${miss.length - 5}` : ''}`,
            duration: 8000,
          });
        } else {
          addToast({ type: 'warning', message: 'Run ไม่ได้ — ไม่มี test case ที่มีทั้ง VCD และ ERoM' });
        }
        return;
      }
      if (missingNames.size > 0) {
        addToast({
          type: 'warning',
          message: `ข้ามไฟล์ที่ไม่ครบใน Library: ${[...missingNames].slice(0, 4).join(', ')}${missingNames.size > 4 ? ` +${missingNames.size - 4}` : ''}`,
        });
      }

      const payload = {
        name: setName,
        configName: setName,
        firmware: firstBinName,
        boards: boardNames,
        files: filesPayload,
        pairsData,
      };
      const created = await createJob(payload, { startImmediately: true });
      if (created) addToast({ type: 'success', message: `sent Run for set "${setName}"` });
      else addToast({ type: 'error', message: `Run set "${setName}" failed` });
    },
    [addToast, boards, createJob, runBoardSelection, uploadedFiles]
  );

  const addTcsPickerOwnTcs = useMemo(
    () =>
      (fileReferenceTestCases || []).filter((t) => {
        const oid = t._ownerId;
        if (oid == null) return true;
        return String(oid) === String(activeProfileId);
      }),
    [fileReferenceTestCases, activeProfileId]
  );

  const addTcsToSetPickerRows = useMemo(() => {
    const setId = addTcsToSetModalSetId;
    if (!setId) return [];
    const currentSet = (savedTestCaseSets || []).find((s) => s.id === setId);
    const inSetKeys = new Set((currentSet?.items || []).map((t) => tcSignatureKeyForDedupe(t)));
    const nameQ = addTcsPickerNameQ.trim().toLowerCase();
    const tagQ = addTcsPickerTagQ.trim().toLowerCase();
    const ownerQ = addTcsPickerOwnerQ.trim().toLowerCase();
    const timeQ = addTcsPickerTimeQ.trim().toLowerCase();

    return addTcsPickerOwnTcs
      .filter((tc) => {
        if (inSetKeys.has(tcSignatureKeyForDedupe(tc))) return false;
        if (nameQ && !String(tc.name || '').toLowerCase().includes(nameQ)) return false;
        if (tagQ) {
          const rawTag = (tc.extraColumns && (tc.extraColumns.tag || tc.extraColumns.Tag)) || '';
          const tags = splitTags(String(rawTag));
          if (!tags.some((x) => x.toLowerCase().includes(tagQ))) return false;
        }
        if (ownerQ) {
          const ownerDisplay = resolveOwnerDisplayName(tc._ownerId ?? activeProfileId, ownerLabelCtx).toLowerCase();
          if (!ownerDisplay.includes(ownerQ)) return false;
        }
        if (timeQ) {
          const last = tc.updatedAt || tc.createdAt;
          const timeStr = last ? String(last).replace('T', ' ').toLowerCase() : '';
          if (!timeStr.includes(timeQ)) return false;
        }
        return true;
      })
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  }, [
    addTcsToSetModalSetId,
    addTcsPickerNameQ,
    addTcsPickerTagQ,
    addTcsPickerOwnerQ,
    addTcsPickerTimeQ,
    addTcsPickerOwnTcs,
    savedTestCaseSets,
    activeProfileId,
    ownerLabelCtx,
  ]);

  const addTcsPickerSelectableIds = useMemo(
    () => addTcsToSetPickerRows.map((t) => String(t.id)).filter(Boolean),
    [addTcsToSetPickerRows]
  );

  const closeAddTcsToSetModal = useCallback(() => {
    setAddTcsToSetModalSetId(null);
    setAddTcsToSetSelectedIds([]);
    setAddTcsPickerNameQ('');
    setAddTcsPickerTagQ('');
    setAddTcsPickerOwnerQ('');
    setAddTcsPickerTimeQ('');
  }, []);

  const handleConfirmAddTcsToSet = useCallback(() => {
    const setId = addTcsToSetModalSetId;
    if (!setId) return;
    const set = (savedTestCaseSets || []).find((s) => s.id === setId);
    if (!set) {
      addToast({ type: 'error', message: 'ไม่พบ set' });
      closeAddTcsToSetModal();
      return;
    }
    const items = Array.isArray(set.items) ? set.items : [];
    const existingKeys = new Set(items.map((t) => tcSignatureKeyForDedupe(t)));
    const pool = (fileReferenceTestCases || []).filter((t) => {
      const oid = t._ownerId;
      if (oid == null) return true;
      return String(oid) === String(activeProfileId);
    });
    const selected = pool.filter((t) => addTcsToSetSelectedIds.includes(String(t.id)));
    if (selected.length === 0) {
      addToast({ type: 'warning', message: 'เลือก test case จาก Library อย่างน้อย 1 รายการ' });
      return;
    }
    const usedNamesInSet = new Set(
      items.map((t) => (t.name || '').trim()).filter(Boolean)
    );
    const newItems = [];
    let skippedDup = 0;
    for (const tc of selected) {
      const k = tcSignatureKeyForDedupe(tc);
      if (existingKeys.has(k)) {
        skippedDup++;
        continue;
      }
      let finalName = (tc.name || '').trim() || 'Test case';
      if (usedNamesInSet.has(finalName)) {
        finalName = pickUniqueNameForAppend(finalName, usedNamesInSet);
      }
      usedNamesInSet.add(finalName);
      newItems.push(cloneSavedLibraryTcToSetItem(tc, finalName));
      existingKeys.add(k);
    }
    if (newItems.length === 0) {
      addToast({ type: 'info', message: 'Test case ที่เลือกมีชุดไฟล์เดียวกับที่อยู่ใน set แล้ว — ไม่มีรายการใหม่' });
      return;
    }
    const mergedItems = [...items, ...newItems];
    const allNames = new Set();
    mergedItems.forEach((t) => {
      collectFileNamesFromTestCase(t).forEach((n) => allNames.add(n));
    });
    const fileLibrarySnapshot = [...allNames].map((n) => ({ name: n }));
    const ok = appendToSavedTestCaseSet(setId, newItems, { fileLibrarySnapshot });
    if (!ok) {
      return;
    }
    const libFiles = Array.isArray(uploadedFiles) ? uploadedFiles : [];
    const nameSet = new Set([...allNames]);
    const fileIds = libFiles.filter((f) => nameSet.has(f.name)).map((f) => f.id).filter(Boolean);
    if (fileIds.length > 0) {
      api.saveSetFiles(setId, fileIds).catch((err) => console.error('Save set files failed', err));
    }
    const setDisplayName = (set.name || '').trim() || 'Set';
    addToast({ type: 'success', message: `เพิ่ม ${newItems.length} test case(s) ใน "${setDisplayName}"` });
    if (skippedDup > 0) {
      addToast({ type: 'info', message: `ข้าม ${skippedDup} รายการที่มีชุดไฟล์ซ้ำกับที่อยู่ใน set แล้ว` });
    }
    closeAddTcsToSetModal();
  }, [
    addTcsToSetModalSetId,
    addTcsToSetSelectedIds,
    savedTestCaseSets,
    fileReferenceTestCases,
    activeProfileId,
    addToast,
    appendToSavedTestCaseSet,
    uploadedFiles,
    collectFileNamesFromTestCase,
    closeAddTcsToSetModal,
  ]);

  const closeRawTcEditor = useCallback(() => {
    setRawTcEditorKey(null);
    setRawTcEditorDraft(null);
    setRawTcEditorMode('edit');
    setRawTcEditorSourceRow(null);
    setRawTcFilePicker(null);
    setRawTcEditorTagToolsOpen(false);
  }, []);

  const rawTcPickerFiles = useMemo(() => {
    if (!rawTcFilePicker) return [];
    const list = Array.isArray(uploadedFiles) ? uploadedFiles : [];
    const q = String(rawTcFilePicker.q || '').trim().toLowerCase();
    const kind = rawTcFilePicker.kind;
    const kindOf = (name) => {
      const ext = String(name || '').split('.').pop()?.toLowerCase();
      if (ext === 'vcd') return 'vcd';
      if (['bin', 'hex', 'elf', 'erom'].includes(ext)) return 'bin';
      if (['lin', 'ulp'].includes(ext)) return 'lin';
      return null;
    };
    const matchQ = (f) => {
      if (!q) return true;
      const name = String(f?.name || '').toLowerCase();
      if (name.includes(q)) return true;
      const tagRaw = String((fileTags && fileTags[f?.id]) || '').toLowerCase();
      if (tagRaw.includes(q)) return true;
      const sizeTxt = String(f?.sizeFormatted ?? f?.size ?? '').toLowerCase();
      if (sizeTxt.includes(q)) return true;
      const ownerDisplay = resolveFileOwnerDisplay(f, ownerLabelCtx).toLowerCase();
      const ownerId = String(f?.ownerId || '').toLowerCase();
      if (`${ownerDisplay} ${ownerId}`.includes(q)) return true;
      const usedByTcs = getTestCasesUsingFile(f?.name, fileReferenceTestCases, fileReferenceTestCaseSets) || [];
      const usedTxt = usedByTcs.map((u) => `${u.name} ${u.set || ''}`).join(' ').toLowerCase();
      if (usedTxt.includes(q)) return true;
      const setNames = getSetNamesUsingFile(f?.name, fileReferenceTestCaseSets) || [];
      if (setNames.join(' ').toLowerCase().includes(q)) return true;
      return false;
    };
    return list
      .filter((f) => kindOf(f?.name) === kind)
      .filter(matchQ);
  }, [rawTcFilePicker, uploadedFiles, fileTags, ownerLabelCtx, fileReferenceTestCases, fileReferenceTestCaseSets]);

  const pickRawTcFileName = useCallback((fileObj) => {
    if (!fileObj?.name) return;
    if (!rawTcFilePicker) return;
    const name = String(fileObj.name);
    const kind = rawTcFilePicker.kind;
    if (kind === 'bin') setRawTcEditorDraft((d) => (d ? { ...d, binName: name } : d));
    if (kind === 'vcd') setRawTcEditorDraft((d) => (d ? { ...d, vcdName: name } : d));
    if (kind === 'lin') setRawTcEditorDraft((d) => (d ? { ...d, linName: name } : d));
    setRawTcFilePicker(null);
  }, [rawTcFilePicker]);

  const handleSaveRawTcEditor = useCallback(() => {
    if (!rawTcEditorKey || !rawTcEditorDraft) return;
    const row = libraryRawRows.find((r) => r._key === rawTcEditorKey) || rawTcEditorSourceRow;
    if (!row) {
      addToast({ type: 'warning', message: 'ไม่สามารถบันทึกรายการนี้ได้' });
      return;
    }
    if (rawTcEditorMode !== 'duplicate' && !canEditRawTcRow(row)) {
      addToast({ type: 'warning', message: 'ไม่สามารถบันทึกรายการนี้ได้' });
      return;
    }
    const name = (rawTcEditorDraft.name || '').trim();
    if (!name) {
      addToast({ type: 'warning', message: 'กรุณากรอกชื่อเทสต์เคส' });
      return;
    }
    const tryCount = Math.min(100, Math.max(1, parseInt(String(rawTcEditorDraft.tryCount), 10) || 1));
    const vcdName = (rawTcEditorDraft.vcdName || '').trim();
    const binName = (rawTcEditorDraft.binName || '').trim();
    const linName = (rawTcEditorDraft.linName || '').trim();
    const tag = (rawTcEditorDraft.tag || '').trim();

    // In "duplicate" mode for Running/Pending rows, prevent saving if user didn't change anything.
    // This avoids clutter of duplicate TC entries that are still the same as the one currently in use.
    if (rawTcEditorMode === 'duplicate') {
      const src = rawTcEditorSourceRow || row;
      const srcTag =
        (src?.extraColumns && (src.extraColumns.tag || src.extraColumns.Tag)) != null
          ? String(src.extraColumns.tag || src.extraColumns.Tag)
          : '';
      const srcTry =
        typeof src?.tryCount === 'number' && src.tryCount > 0 ? src.tryCount : 1;

      const sigSlots = (slots) =>
        (Array.isArray(slots) ? slots : [])
          .map((s) => ({
            kind: String(s?.kind || '').trim(),
            file: String(s?.file || '').trim(),
          }))
          .filter((x) => x.kind && x.file)
          .sort((a, b) => (a.kind + a.file).localeCompare(b.kind + b.file))
          .map((x) => `${x.kind}:${x.file}`)
          .join('|');

      const srcDraft = buildRawTcDraft(src);
      const colorSigForDraft = (draft) => {
        const parts = splitTags((draft?.tag || '').trim());
        if (!parts.length) return '';
        return normalizeTagColorList(
          { tagColor: draft.tagColor, tagColorList: draft.tagColorList },
          parts.length
        ).join('|');
      };
      const sameFiles =
        String(vcdName).trim() === String(src?.vcdName || '').trim() &&
        String(binName).trim() === String(src?.binName || '').trim() &&
        String(linName).trim() === String(src?.linName || '').trim() &&
        String(tryCount) === String(srcTry) &&
        String(tag).trim() === String(srcTag).trim() &&
        colorSigForDraft(rawTcEditorDraft) === colorSigForDraft(srcDraft) &&
        sigSlots(rawTcEditorDraft.extraSlots) === sigSlots(srcDraft.extraSlots);

      if (sameFiles) {
        addToast({
          type: 'warning',
          message: 'Duplicate the test case but you must change at least one thing before saving as new (e.g. change VCD/ERoM/ULP file, tag, or additional file)',
        });
        return;
      }
    }

    const mkCmd = (type, file, idx) => ({
      id: `cmd-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 9)}`,
      type,
      file,
    });
    let cmdIdx = 0;
    const vcdCmds = [];
    const eromCmds = [];
    const ulpCmds = [];
    const mdiCmds = [];
    for (const slot of rawTcEditorDraft.extraSlots || []) {
      const f = (slot?.file || '').trim();
      if (!f) continue;
      const k = slot?.kind;
      if (k === 'vcd') vcdCmds.push(mkCmd('vcd', f, cmdIdx++));
      else if (k === 'erom') eromCmds.push(mkCmd('erom', f, cmdIdx++));
      else if (k === 'ulp') ulpCmds.push(mkCmd('ulp', f, cmdIdx++));
      else if (k === 'mdi') mdiCmds.push(mkCmd('mdi', f, cmdIdx++));
    }
    const commands = [...vcdCmds, ...eromCmds, ...ulpCmds, ...mdiCmds];

    const baseExtra = row.extraColumns && typeof row.extraColumns === 'object' ? { ...row.extraColumns } : {};
    Object.keys(baseExtra).forEach((k) => {
      const m = k.match(/^(VCD|ERoM|ULP)(\d+)$/i);
      if (m && parseInt(m[2], 10) >= 2) delete baseExtra[k];
    });
    const nextExtra = { ...baseExtra };
    if (tag) {
      nextExtra.tag = tag;
      const tagArr = splitTags(tag);
      const fb = TAG_PALETTE_MAP[rawTcEditorDraft.tagColor] ? rawTcEditorDraft.tagColor : 'mint';
      const prevList = Array.isArray(rawTcEditorDraft.tagColorList) ? rawTcEditorDraft.tagColorList : [];
      nextExtra.tagColor = fb;
      nextExtra.tagColorList = tagArr.map((_, i) => {
        const k = prevList[i];
        return TAG_PALETTE_MAP[k] ? k : fb;
      });
      if (nextExtra.tag_color != null) delete nextExtra.tag_color;
    } else {
      delete nextExtra.tag;
      delete nextExtra.Tag;
      delete nextExtra.tagColor;
      delete nextExtra.tag_color;
      delete nextExtra.tagColorList;
    }

    const nextTc = {
      ...row,
      name,
      tryCount,
      vcdName,
      binName,
      linName,
      commands,
      extraColumns: nextExtra,
    };
    const mergedExtra = mergeCommandsIntoExtraForTc(nextTc);
    const payload = {
      name,
      tryCount,
      vcdName,
      binName,
      linName,
      commands,
      extraColumns: Object.keys(mergedExtra).length ? mergedExtra : undefined,
    };

    if (rawTcEditorMode === 'duplicate') {
      addSavedTestCase({
        ...payload,
        createdAt: new Date().toISOString(),
      });
      addToast({ type: 'success', message: 'Saved as new test case' });
      closeRawTcEditor();
      return;
    }

    if (row._source === 'current' && row.id) {
      updateSavedTestCase(row.id, payload);
      addToast({ type: 'success', message: 'บันทึกเทสต์เคสแล้ว' });
      closeRawTcEditor();
      return;
    }
    if (row._source === 'set' && row._setId != null && row._itemIndex != null) {
      const set = (savedTestCaseSets || []).find((s) => s.id === row._setId);
      if (!set || !Array.isArray(set.items)) {
        addToast({ type: 'error', message: 'ไม่พบชุดเทสต์เคส' });
        return;
      }
      const prevItem = set.items[row._itemIndex];
      if (!prevItem) {
        addToast({ type: 'error', message: 'ไม่พบรายการใน set' });
        return;
      }
      const updatedItem = {
        ...prevItem,
        ...payload,
        id: prevItem.id,
      };
      const newItems = [...set.items];
      newItems[row._itemIndex] = updatedItem;
      const allNames = new Set();
      newItems.forEach((t) => {
        collectFileNamesFromTestCase(t).forEach((n) => allNames.add(n));
      });
      const fileLibrarySnapshot = [...allNames].map((n) => ({ name: n }));
      updateSavedTestCaseSet(row._setId, { items: newItems, fileLibrarySnapshot });
      addToast({ type: 'success', message: 'บันทึกเทสต์เคสใน set แล้ว' });
      closeRawTcEditor();
      return;
    }
    addToast({ type: 'warning', message: 'บันทึกไม่สำเร็จ — ไม่รู้จักแหล่งข้อมูล' });
  }, [
    rawTcEditorKey,
    rawTcEditorDraft,
    libraryRawRows,
    canEditRawTcRow,
    addToast,
    mergeCommandsIntoExtraForTc,
    collectFileNamesFromTestCase,
    addSavedTestCase,
    updateSavedTestCase,
    updateSavedTestCaseSet,
    savedTestCaseSets,
    buildRawTcDraft,
    closeRawTcEditor,
    rawTcEditorMode,
    rawTcEditorSourceRow,
  ]);

  useEffect(() => {
    if (!rawTcEditorKey) return;
    const stillThere = libraryRawRows.some((r) => r._key === rawTcEditorKey);
    if (!stillThere) closeRawTcEditor();
  }, [rawTcEditorKey, libraryRawRows, closeRawTcEditor]);

  useEffect(() => {
    if (!rawTcEditorTagToolsOpen) return;
    const onDoc = (e) => {
      if (rawTcEditorTagToolsRef.current && !rawTcEditorTagToolsRef.current.contains(e.target)) {
        setRawTcEditorTagToolsOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [rawTcEditorTagToolsOpen]);

  useEffect(() => {
    const onMouseUp = () => {
      isDragSelectingLibraryRef.current = false;
      isDragSelectingLibrarySetRef.current = false;
      isDragSelectingFileRef.current = false;
      isDragSelectingAddTcPickerRef.current = false;
    };
    window.addEventListener('mouseup', onMouseUp);
    return () => window.removeEventListener('mouseup', onMouseUp);
  }, []);

  const handleDeleteAll = async () => {
    if (!uploadedFiles?.length) return;
    const inUseCount = uploadedFiles.filter((f) => fileNamesInUseByBatch.has(f.name)).length;
    const toDelete = uploadedFiles.filter((f) => !fileNamesInUseByBatch.has(f.name));
    if (toDelete.length === 0) {
      addToast({ type: 'warning', message: 'ไฟล์ทั้งหมดกำลังถูกใช้โดย set (running/pending) — ไม่สามารถลบได้จนกว่า process จะจบ' });
      return;
    }
    if (!window.confirm(`Delete ${toDelete.length} file(s) from Library?${inUseCount > 0 ? `\n\n${inUseCount} file(s) กำลังถูกใช้ (running/pending) จะไม่ถูกลบ` : ''}`)) return;
    setIsDeleting(true);
    let deleted = 0;
    for (const f of toDelete) {
      const ok = await removeUploadedFile(f.id);
      if (ok) deleted++;
    }
    setIsDeleting(false);
    if (deleted > 0) addToast({ type: 'success', message: `Deleted ${deleted} file(s)` });
    if (inUseCount > 0) addToast({ type: 'info', message: `${inUseCount} file(s) ไม่ถูกลบ (กำลังถูกใช้โดย set)` });
  };

  const handleDeleteBox = async (setId, files) => {
    if (!files?.length) return;
    const toDelete = files.filter((f) => !fileNamesInUseByBatch.has(f.name));
    const inUseCount = files.length - toDelete.length;
    if (toDelete.length === 0) {
      addToast({ type: 'warning', message: 'ไฟล์ในกล่องนี้ทั้งหมดกำลังถูกใช้ (running/pending) — ไม่สามารถลบได้' });
      return;
    }
    if (!window.confirm(`Delete ${toDelete.length} file(s) in this box from Library?${inUseCount > 0 ? `\n\n${inUseCount} file(s) กำลังถูกใช้ จะไม่ถูกลบ` : ''}`)) return;
    setDeletingBoxId(setId);
    let deleted = 0;
    for (const f of toDelete) {
      const ok = await removeUploadedFile(f.id);
      if (ok) deleted++;
    }
    setDeletingBoxId(null);
    if (deleted > 0) addToast({ type: 'success', message: `Deleted ${deleted} file(s) from box` });
    if (inUseCount > 0) addToast({ type: 'info', message: `${inUseCount} file(s) ไม่ถูกลบ (กำลังถูกใช้)` });
  };

  return (
    <div className="w-full max-w-6xl mx-auto space-y-6">
      {isImportModalOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => { if (!isImporting) setIsImportModalOpen(false); }}
          />
          <div className="relative w-[min(900px,calc(100vw-2rem))] max-h-[calc(100vh-2rem)] overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl">
            <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2">
              <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center">
                <Upload size={18} />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">
                  Import files
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Drop/paste/add more files, preview, set name/tag, then save
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsImportModalOpen(false)}
                disabled={isImporting}
                className="ml-auto p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-60"
                title="Close"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto max-h-[calc(100vh-10rem)]">
              <div
                className={`rounded-xl border-2 border-dashed p-4 flex flex-col sm:flex-row sm:items-center gap-3 ${
                  isImportDragging
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                    : 'border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30'
                }`}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsImportDragging(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (!e.currentTarget.contains(e.relatedTarget)) setIsImportDragging(false);
                }}
                onDrop={async (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsImportDragging(false);
                  const files = await collectFilesFromDataTransfer(e.dataTransfer);
                  if (files?.length) enqueueImportDrafts(files);
                }}
                onPaste={(e) => {
                  const items = e.clipboardData?.items || [];
                  const files = [];
                  for (const it of items) {
                    if (it.kind === 'file') {
                      const f = it.getAsFile();
                      if (f) files.push(f);
                    }
                  }
                  if (files.length) enqueueImportDrafts(files);
                }}
                tabIndex={0}
              >
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                    Drop files/folder here
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Or paste (Cmd+V) or browse files
                  </div>
                </div>
                <div className="sm:ml-auto flex items-center gap-2">
                  <input
                    ref={fileImportInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      const files = e.target.files;
                      if (files?.length) enqueueImportDrafts(files);
                      e.target.value = '';
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => fileImportInputRef.current?.click()}
                    disabled={isImporting}
                    className="px-3 py-2 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    Browse
                  </button>
                  {isImporting && <span className="text-xs text-slate-500 dark:text-slate-400">Saving…</span>}
                </div>
              </div>

              {importDrafts.length === 0 ? (
                <div className="text-center text-slate-500 dark:text-slate-400 py-10">
                  Drop or browse to add files.
                </div>
              ) : (
                <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                  <div className="px-4 py-2 bg-slate-50 dark:bg-slate-800/40 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                      Preview ({importDrafts.length})
                    </span>
                    <button
                      type="button"
                      onClick={() => setImportDrafts([])}
                      disabled={isImporting}
                      className="ml-auto px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-200 text-slate-800 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600 disabled:opacity-60"
                    >
                      Clear
                    </button>
                    <button
                      type="button"
                      onClick={() => void saveImportDraftsToLibrary()}
                      disabled={isImporting}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"
                    >
                      Save to Library
                    </button>
                    <button
                      type="button"
                      onClick={() => void saveImportDraftsToLibraryAndSendToRunSet()}
                      disabled={isImporting}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
                      title="Save files to Library, then go to Run Set"
                    >
                      Save&Send to run set
                    </button>
                  </div>
                  <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                    {importDrafts.map((d) => (
                      <div key={d.id} className="px-4 py-2 flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 w-14">Name</span>
                        <input
                          type="text"
                          value={d.name}
                          onChange={(e) => setImportDrafts((prev) => prev.map((x) => x.id === d.id ? { ...x, name: e.target.value } : x))}
                          disabled={isImporting}
                          className="px-2 py-1 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 min-w-[220px] flex-1"
                        />
                        <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 w-10">Tag</span>
                        <div className="flex flex-col gap-1">
                          <input
                            type="text"
                            value={d.tag}
                            onChange={(e) =>
                              setImportDrafts((prev) =>
                                prev.map((x) => (x.id === d.id ? { ...x, tag: e.target.value } : x))
                              )
                            }
                            onDoubleClick={() => {
                              if (!isImporting) setImportTagHistoryOpenId(d.id);
                            }}
                            disabled={isImporting}
                            className="px-2 py-1 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 w-44"
                            placeholder="tag"
                          />
                          {importTagHistoryOpenId === d.id && fileTagHistory.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {fileTagHistory
                                .filter((t) => {
                                  const q = String(d.tag || '').trim().toLowerCase();
                                  const lt = t.toLowerCase();
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
                                      setImportDrafts((prev) =>
                                        prev.map((x) =>
                                          x.id === d.id ? { ...x, tag: t } : x
                                        )
                                      );
                                      setImportTagHistoryOpenId(null);
                                    }}
                                    className="px-2 py-0.5 rounded-full text-[11px] font-medium border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
                                    title={`Use tag "${t}"`}
                                  >
                                    {t}
                                  </button>
                                ))}
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => setImportDrafts((prev) => prev.filter((x) => x.id !== d.id))}
                          disabled={isImporting}
                          className="ml-auto p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-60"
                          title="Remove"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {addTcsToSetModalSetId && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 bg-black/50">
          <div className="absolute inset-0" onClick={closeAddTcsToSetModal} role="presentation" />
          <div
            className="relative bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-600 w-full max-w-6xl max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-tcs-to-set-title"
          >
            <div className="p-4 border-b border-slate-200 dark:border-slate-600 shrink-0">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-slate-700 dark:bg-slate-600 text-white flex items-center justify-center shrink-0">
                  <FolderOpen size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 id="add-tcs-to-set-title" className="text-lg font-bold text-slate-800 dark:text-slate-100">
                    Select test cases from Library
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Same pool as Test Case Library (local + synced). Rows already in this set (same file signature) are hidden.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeAddTcsToSetModal}
                  className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
                  title="Close"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 mt-3">
                <label className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Name</span>
                  <input
                    type="text"
                    value={addTcsPickerNameQ}
                    onChange={(e) => setAddTcsPickerNameQ(e.target.value)}
                    placeholder="Search name…"
                    className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                  />
                </label>
                <label className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Tag</span>
                  <input
                    type="text"
                    value={addTcsPickerTagQ}
                    onChange={(e) => setAddTcsPickerTagQ(e.target.value)}
                    placeholder="Search tag…"
                    className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                  />
                </label>
                <label className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Owner</span>
                  <input
                    type="text"
                    value={addTcsPickerOwnerQ}
                    onChange={(e) => setAddTcsPickerOwnerQ(e.target.value)}
                    placeholder="Profile name…"
                    className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                  />
                </label>
                <label className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Time</span>
                  <input
                    type="text"
                    value={addTcsPickerTimeQ}
                    onChange={(e) => setAddTcsPickerTimeQ(e.target.value)}
                    placeholder="2026-04-06…"
                    className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                  />
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-3 mt-3">
                <button
                  type="button"
                  onClick={() => setAddTcsToSetSelectedIds([...addTcsPickerSelectableIds])}
                  className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-40"
                  disabled={addTcsPickerSelectableIds.length === 0}
                >
                  Select all shown
                </button>
                <button
                  type="button"
                  onClick={() => setAddTcsToSetSelectedIds([])}
                  className="text-xs font-semibold text-slate-500 hover:underline"
                >
                  Clear selection
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAddTcsPickerNameQ('');
                    setAddTcsPickerTagQ('');
                    setAddTcsPickerOwnerQ('');
                    setAddTcsPickerTimeQ('');
                  }}
                  className="text-xs font-semibold text-slate-500 hover:underline"
                >
                  Clear filters
                </button>
              </div>
            </div>
            <div
              className="overflow-auto flex-1 min-h-[160px] border-t border-slate-100 dark:border-slate-700"
              title="Click and drag across rows to select multiple test cases"
            >
              {addTcsToSetPickerRows.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400 p-6 text-center">
                  {addTcsPickerOwnTcs.length === 0
                    ? 'No test cases in your library yet — create and save on the Test Cases page, or wait for server sync.'
                    : 'No matching test cases (filters / already in this set).'}
                </p>
              ) : (
                <table className="w-full text-left text-xs border-collapse select-none">
                  <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-slate-900/95 border-b border-slate-200 dark:border-slate-600">
                    <tr className="text-slate-600 dark:text-slate-300">
                      <th className="w-10 px-2 py-2 font-semibold">
                        <span className="sr-only">Select</span>
                      </th>
                      <th className="px-2 py-2 font-semibold min-w-[120px]">Name</th>
                      <th className="px-2 py-2 font-semibold min-w-[100px]">VCD</th>
                      <th className="px-2 py-2 font-semibold min-w-[100px]">ERoM</th>
                      <th className="px-2 py-2 font-semibold min-w-[100px]">ULP</th>
                      <th className="px-2 py-2 font-semibold min-w-[100px]">Tags</th>
                      <th className="px-2 py-2 font-semibold min-w-[90px]">Owner</th>
                      <th className="px-2 py-2 font-semibold min-w-[120px]">Modified</th>
                    </tr>
                  </thead>
                  <tbody>
                    {addTcsToSetPickerRows.map((tc) => {
                      const idStr = String(tc.id);
                      const checked = addTcsToSetSelectedIds.includes(idStr);
                      const rawTag = (tc.extraColumns && (tc.extraColumns.tag || tc.extraColumns.Tag)) || '';
                      const tags = splitTags(String(rawTag));
                      const timeStr = (() => {
                        const last = tc.updatedAt || tc.createdAt;
                        return last ? String(last).replace('T', ' ').slice(0, 19) : '—';
                      })();
                      return (
                        <tr
                          key={idStr}
                          className={`border-b border-slate-100 dark:border-slate-700 ${checked ? 'bg-blue-50/80 dark:bg-blue-900/25' : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'}`}
                          onMouseDown={(e) => {
                            if (e.button !== 0) return;
                            if (e.target.closest('input[type="checkbox"]')) return;
                            isDragSelectingAddTcPickerRef.current = true;
                            setAddTcsToSetSelectedIds((prev) => (prev.includes(idStr) ? prev : [...prev, idStr]));
                          }}
                          onMouseEnter={() => {
                            if (!isDragSelectingAddTcPickerRef.current) return;
                            setAddTcsToSetSelectedIds((prev) => (prev.includes(idStr) ? prev : [...prev, idStr]));
                          }}
                        >
                          <td className="px-2 py-2 align-top" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              className="rounded border-slate-300 dark:border-slate-600"
                              checked={checked}
                              onChange={() => {
                                setAddTcsToSetSelectedIds((prev) =>
                                  prev.includes(idStr) ? prev.filter((x) => x !== idStr) : [...prev, idStr]
                                );
                              }}
                            />
                          </td>
                          <td className="px-2 py-2 font-medium text-slate-800 dark:text-slate-100 align-top">{tc.name || '—'}</td>
                          <td className="px-2 py-2 text-slate-600 dark:text-slate-300 align-top truncate max-w-[140px]" title={(tc.vcdName || '').trim() || undefined}>
                            {(tc.vcdName || '').trim() || '—'}
                          </td>
                          <td className="px-2 py-2 text-slate-600 dark:text-slate-300 align-top truncate max-w-[140px]" title={(tc.binName || '').trim() || undefined}>
                            {(tc.binName || '').trim() || '—'}
                          </td>
                          <td className="px-2 py-2 text-slate-600 dark:text-slate-300 align-top truncate max-w-[140px]" title={(tc.linName || '').trim() || undefined}>
                            {(tc.linName || '').trim() || '—'}
                          </td>
                          <td className="px-2 py-2 align-top">
                            {!tags.length ? (
                              <span className="text-slate-400">—</span>
                            ) : (
                              <span className="text-[11px] text-slate-600 dark:text-slate-300 truncate block max-w-[160px]" title={tags.join(', ')}>
                                {tags.slice(0, 2).join(', ')}
                                {tags.length > 2 ? ` +${tags.length - 2}` : ''}
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-2 text-slate-600 dark:text-slate-300 align-top truncate max-w-[100px]">
                            {resolveOwnerDisplayName(tc._ownerId ?? activeProfileId, ownerLabelCtx)}
                          </td>
                          <td className="px-2 py-2 text-slate-500 dark:text-slate-400 align-top whitespace-nowrap">{timeStr}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
            <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-600 flex items-center justify-end gap-2 shrink-0">
              <span className="text-xs text-slate-500 mr-auto">{addTcsToSetSelectedIds.length} selected</span>
              <button
                type="button"
                onClick={closeAddTcsToSetModal}
                className="px-4 py-2 text-sm font-semibold rounded-lg border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmAddTcsToSet()}
                disabled={addTcsToSetSelectedIds.length === 0}
                className="px-4 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:pointer-events-none"
              >
                Add to set
              </button>
            </div>
          </div>
        </div>
      )}

      {showAllTagsForFileId && (
        <div className="fixed inset-0 z-[85] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => {
              setShowAllTagsForFileId(null);
              setFileTagsModalEditIndex(null);
              setFileTagsModalEditDraft('');
              setFileTagsModalAddDraft('');
              setFileTagsModalAddOpen(false);
            }}
            role="presentation"
          />
          <div
            className="relative w-[min(520px,calc(100vw-2rem))] rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2 flex-wrap overflow-visible">
              <div className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">Tags</div>
              {(() => {
                const fid = showAllTagsForFileId;
                if (!fid) return null;
                const curRaw = fileTagColors?.[fid] || 'mint';
                const safe = TAG_PALETTE_MAP[curRaw] ? curRaw : 'mint';
                return (
                  <>
                    <span
                      className="shrink-0 w-px h-5 self-center bg-slate-200 dark:bg-slate-600 mx-2"
                      aria-hidden
                    />
                    <TagColorSwatchPicker
                      size="sm"
                      value={safe}
                      menuZClass="z-[120]"
                      disabled={fileTagsModalPendingBusy}
                      onChange={(k) => setFileTagColor?.(fid, k)}
                    />
                  </>
                );
              })()}
              <button
                type="button"
                onClick={() => {
                  setShowAllTagsForFileId(null);
                  setFileTagsModalEditIndex(null);
                  setFileTagsModalEditDraft('');
                  setFileTagsModalAddDraft('');
                  setFileTagsModalAddOpen(false);
                }}
                className="ml-auto p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                title="Close"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-5 max-h-[min(60vh,360px)] overflow-y-auto">
              {(() => {
                const fid = showAllTagsForFileId;
                const raw = (fileTags && fileTags[fid]) || '';
                const tags = splitTags(raw);
                const colorKey = FILE_TAG_PALETTE_MAP[fileTagColors?.[fid]] ? fileTagColors[fid] : 'mint';
                const pillClass = FILE_TAG_PALETTE_MAP[colorKey] || FILE_TAG_PALETTE_MAP.mint;
                const commitFileTagsModalEdit = () => {
                  if (fileTagsModalPendingBusy) return;
                  if (fileTagsModalEditIndex == null) return;
                  const r = (fileTags && fileTags[fid]) || '';
                  const next = replaceTagAtIndexInRaw(r, fileTagsModalEditIndex, fileTagsModalEditDraft);
                  setFileTag?.(fid, next);
                  setFileTagsModalEditIndex(null);
                  setFileTagsModalEditDraft('');
                };
                return (
                  <div className="space-y-3">
                    {tags.length === 0 ? (
                      <div className="text-sm text-slate-500 dark:text-slate-400">No tags yet</div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {tags.map((t, i) => (
                          <span
                            key={`${fid}-alltag-${i}`}
                            className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs border ${pillClass}`}
                          >
                            {fileTagsModalEditIndex === i ? (
                              <input
                                type="text"
                                value={fileTagsModalEditDraft}
                                onChange={(e) => setFileTagsModalEditDraft(e.target.value)}
                                readOnly={fileTagsModalPendingBusy}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    commitFileTagsModalEdit();
                                  }
                                  if (e.key === 'Escape') {
                                    e.preventDefault();
                                    setFileTagsModalEditIndex(null);
                                    setFileTagsModalEditDraft('');
                                  }
                                }}
                                onBlur={commitFileTagsModalEdit}
                                className="min-w-[100px] max-w-[280px] px-2 py-0.5 text-xs rounded-md border border-blue-400 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                                autoFocus
                              />
                            ) : (
                              <button
                                type="button"
                                disabled={fileTagsModalPendingBusy}
                                onClick={() => {
                                  setFileTagsModalEditIndex(i);
                                  setFileTagsModalEditDraft(t);
                                }}
                                className="max-w-[260px] truncate text-left font-medium hover:underline disabled:opacity-50 disabled:pointer-events-none"
                                title="คลิกเพื่อแก้ไขชื่อ"
                              >
                                {t}
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={fileTagsModalPendingBusy}
                              onMouseDown={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                if (fileTagsModalPendingBusy) return;
                                if (fileTagsModalEditIndex === i) {
                                  setFileTagsModalEditIndex(null);
                                  setFileTagsModalEditDraft('');
                                }
                                const r0 = (fileTags && fileTags[fid]) || '';
                                setFileTag?.(fid, removeTagAtIndexFromRaw(r0, i));
                              }}
                              className="ml-0.5 w-5 h-5 rounded-full inline-flex items-center justify-center hover:bg-black/10 dark:hover:bg-white/10 disabled:opacity-40 disabled:pointer-events-none"
                              title="Remove tag"
                            >
                              <X size={12} />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      {fileTagsModalAddOpen ? (
                        <input
                          type="text"
                          value={fileTagsModalAddDraft}
                          onChange={(e) => setFileTagsModalAddDraft(e.target.value)}
                          readOnly={fileTagsModalPendingBusy}
                          onKeyDown={(e) => {
                            if (fileTagsModalPendingBusy) return;
                            if (e.key === 'Escape') {
                              e.preventDefault();
                              setFileTagsModalAddOpen(false);
                              setFileTagsModalAddDraft('');
                              return;
                            }
                            if (e.key !== 'Enter') return;
                            e.preventDefault();
                            const add = fileTagsModalAddDraft.trim();
                            if (!add) {
                              setFileTagsModalAddOpen(false);
                              return;
                            }
                            const r = (fileTags && fileTags[fid]) || '';
                            const oldLower = new Set(splitTags(r).map((t) => String(t).toLowerCase()));
                            const added = splitTags(add).filter((t) => !oldLower.has(String(t).toLowerCase()));
                            if (added.length) recordMyAddedTagsForEntity(activeProfileId, `file:${fid}`, added);
                            setFileTag?.(fid, upsertTagsString(r, add));
                            setFileTagsModalAddDraft('');
                            setFileTagsModalAddOpen(false);
                          }}
                          onBlur={() => {
                            const add = fileTagsModalAddDraft.trim();
                            if (!add) {
                              setFileTagsModalAddOpen(false);
                              setFileTagsModalAddDraft('');
                            }
                          }}
                          className="flex-1 min-w-[160px] px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100"
                          placeholder="Type and press Enter (comma allowed)"
                          autoFocus
                        />
                      ) : (
                        <button
                          type="button"
                          disabled={fileTagsModalPendingBusy}
                          onClick={() => {
                            setFileTagsModalAddOpen(true);
                            setFileTagsModalAddDraft('');
                          }}
                          className="inline-flex items-center justify-center w-9 h-9 rounded-full border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 shadow-sm disabled:opacity-40 disabled:pointer-events-none"
                          title="Add tag"
                        >
                          <Plus size={18} strokeWidth={2.5} />
                        </button>
                      )}
                    </div>
                    {fileTagsModalAddOpen && fileTagHistory.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {(() => {
                          const existingLower = new Set(tags.map((t) => t.toLowerCase()));
                          const q = fileTagsModalAddDraft.trim().toLowerCase();
                          return fileTagHistory
                            .filter((t) => {
                              const lt = t.toLowerCase();
                              if (existingLower.has(lt)) return false;
                              if (q && !lt.includes(q)) return false;
                              return true;
                            })
                            .slice(0, 12)
                            .map((t) => (
                              <button
                                key={t}
                                type="button"
                                disabled={fileTagsModalPendingBusy}
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  if (fileTagsModalPendingBusy) return;
                                  const r = (fileTags && fileTags[fid]) || '';
                                  const oldLower = new Set(splitTags(r).map((x) => String(x).toLowerCase()));
                                  const added = splitTags(t).filter(
                                    (x) => !oldLower.has(String(x).toLowerCase())
                                  );
                                  if (added.length) {
                                    recordMyAddedTagsForEntity(activeProfileId, `file:${fid}`, added);
                                  }
                                  setFileTag?.(fid, upsertTagsString(r, t));
                                  setFileTagsModalAddDraft('');
                                  setFileTagsModalAddOpen(false);
                                }}
                                className="px-2 py-0.5 rounded-full text-[11px] font-medium border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 disabled:pointer-events-none"
                                title={`Use tag "${t}"`}
                              >
                                {t}
                              </button>
                            ));
                        })()}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {libraryRawTcTagOverflowKey && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => {
              setLibraryRawTcTagOverflowKey(null);
              setLibraryRawTcTagModalAddDraft('');
              setLibraryRawTcTagModalEditIndex(null);
              setLibraryRawTcTagModalEditDraft('');
            }}
            role="presentation"
          />
          <div
            className="relative w-[min(520px,calc(100vw-2rem))] rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2 flex-wrap overflow-visible">
              <div className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">Tags</div>
              {(() => {
                const hdr = libraryFilteredRows.find((r) => (r._key || '') === libraryRawTcTagOverflowKey);
                const hdrLocked =
                  !hdr ||
                  hdr._status === 'running' ||
                  hdr._status === 'pending' ||
                  isTcManuallyClosed(hdr) ||
                  (hdr._ownerId != null && hdr._ownerId !== activeProfileId);
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
                      menuZClass="z-[120]"
                      onChange={(k) => {
                        if (!hdr) return;
                        const r = (hdr.extraColumns && (hdr.extraColumns.tag || hdr.extraColumns.Tag)) || '';
                        const tagArr = splitTags(r);
                        const patch = { tagColor: k };
                        if (tagArr.length) patch.tagColorList = tagArr.map(() => k);
                        patchLibraryTcExtraColumns(hdr, patch);
                      }}
                    />
                  </>
                );
              })()}
              <button
                type="button"
                onClick={() => {
                  setLibraryRawTcTagOverflowKey(null);
                  setLibraryRawTcTagModalAddDraft('');
                  setLibraryRawTcTagModalEditIndex(null);
                  setLibraryRawTcTagModalEditDraft('');
                }}
                className="ml-auto p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                title="Close"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-5 max-h-[min(60vh,360px)] overflow-y-auto">
              {(() => {
                const otc = libraryFilteredRows.find((r) => (r._key || '') === libraryRawTcTagOverflowKey);
                if (!otc) {
                  return <div className="text-sm text-slate-500 dark:text-slate-400">—</div>;
                }
                const raw = (otc.extraColumns && (otc.extraColumns.tag || otc.extraColumns.Tag)) || '';
                const allTags = splitTags(raw);
                const tagModalColorList = normalizeTagColorList(otc.extraColumns, allTags.length);
                const modalLocked =
                  otc._status === 'running' ||
                  otc._status === 'pending' ||
                  isTcManuallyClosed(otc) ||
                  (otc._ownerId != null && otc._ownerId !== activeProfileId);
                const commitLibraryRawTcTagModalEdit = () => {
                  if (libraryRawTcTagModalEditIndex == null) return;
                  const row = libraryFilteredRows.find((r) => (r._key || '') === libraryRawTcTagOverflowKey);
                  if (!row) {
                    setLibraryRawTcTagModalEditIndex(null);
                    setLibraryRawTcTagModalEditDraft('');
                    return;
                  }
                  const r = (row.extraColumns && (row.extraColumns.tag || row.extraColumns.Tag)) || '';
                  const next = replaceTagAtIndexInRaw(r, libraryRawTcTagModalEditIndex, libraryRawTcTagModalEditDraft);
                  patchLibraryTcExtraColumns(row, { tag: next });
                  setLibraryRawTcTagModalEditIndex(null);
                  setLibraryRawTcTagModalEditDraft('');
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
                              key={`lib-raw-tc-alltag-${libraryRawTcTagOverflowKey}-${i}`}
                              className="flex items-center gap-1.5 flex-wrap min-w-0"
                            >
                              <span
                                className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs border ${pillCls}`}
                              >
                                {libraryRawTcTagModalEditIndex === i ? (
                                  <input
                                    type="text"
                                    value={libraryRawTcTagModalEditDraft}
                                    onChange={(e) => setLibraryRawTcTagModalEditDraft(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        if (tagEnterShouldIgnoreIme(e)) return;
                                        e.preventDefault();
                                        commitLibraryRawTcTagModalEdit();
                                      }
                                      if (e.key === 'Escape') {
                                        e.preventDefault();
                                        setLibraryRawTcTagModalEditIndex(null);
                                        setLibraryRawTcTagModalEditDraft('');
                                      }
                                    }}
                                    onBlur={commitLibraryRawTcTagModalEdit}
                                    className="min-w-[100px] max-w-[280px] px-2 py-0.5 text-xs rounded-md border border-slate-400/80 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                                    autoFocus
                                  />
                                ) : (
                                  <button
                                    type="button"
                                    disabled={modalLocked}
                                    onClick={() => {
                                      if (modalLocked) return;
                                      setLibraryRawTcTagModalEditIndex(i);
                                      setLibraryRawTcTagModalEditDraft(t);
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
                                      if (libraryRawTcTagModalEditIndex === i) {
                                        setLibraryRawTcTagModalEditIndex(null);
                                        setLibraryRawTcTagModalEditDraft('');
                                      }
                                      const row = libraryFilteredRows.find(
                                        (r) => (r._key || '') === libraryRawTcTagOverflowKey
                                      );
                                      if (!row) return;
                                      const r0 = (row.extraColumns && (row.extraColumns.tag || row.extraColumns.Tag)) || '';
                                      patchLibraryTcExtraColumns(row, { tag: removeTagAtIndexFromRaw(r0, i) });
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
                          value={libraryRawTcTagModalAddDraft}
                          onChange={(e) => setLibraryRawTcTagModalAddDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key !== 'Enter') return;
                            if (tagEnterShouldIgnoreIme(e)) return;
                            e.preventDefault();
                            const add = libraryRawTcTagModalAddDraft.trim();
                            if (!add) return;
                            const r =
                              (otc.extraColumns && (otc.extraColumns.tag || otc.extraColumns.Tag)) || '';
                            const next = upsertTagsString(r, add);
                            patchLibraryTcExtraColumns(otc, { tag: next });
                            setLibraryRawTcTagModalAddDraft('');
                          }}
                          className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100"
                          placeholder="Type and press Enter (comma allowed)"
                        />
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {showAllUsedByTcForFileName && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setShowAllUsedByTcForFileName(null)}
            role="presentation"
          />
          <div className="relative w-[min(520px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl">
            <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2">
              <div className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">Used by test cases</div>
              <button
                type="button"
                onClick={() => setShowAllUsedByTcForFileName(null)}
                className="ml-auto p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                title="Close"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-5 max-h-[min(60vh,360px)] overflow-y-auto">
              {(() => {
                let list = getTestCasesUsingFile(showAllUsedByTcForFileName, fileReferenceTestCases, fileReferenceTestCaseSets);
                if ((list?.length || 0) === 0) {
                  list = getJobRefsUsingFile(showAllUsedByTcForFileName, jobs).usedByTcs;
                }
                return list.length === 0 ? (
                  <div className="text-sm text-slate-500 dark:text-slate-400">—</div>
                ) : (
                  <ul className="space-y-2 text-sm text-slate-700 dark:text-slate-200">
                    {list.map((u, idx) => (
                      <li
                        key={`lib-tc-all-${idx}-${u.name}-${u.set || ''}`}
                        className="flex flex-col gap-0.5 border-b border-slate-100 dark:border-slate-700 pb-2 last:border-0 last:pb-0"
                      >
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

      {showAllSetsForFileName && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setShowAllSetsForFileName(null)}
            role="presentation"
          />
          <div className="relative w-[min(480px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl">
            <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2">
              <div className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">Sets using this file</div>
              <button
                type="button"
                onClick={() => setShowAllSetsForFileName(null)}
                className="ml-auto p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                title="Close"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-5 max-h-[min(60vh,360px)] overflow-y-auto">
              {(() => {
                let names = getSetNamesUsingFile(showAllSetsForFileName, fileReferenceTestCaseSets);
                if ((names?.length || 0) === 0) {
                  names = getJobRefsUsingFile(showAllSetsForFileName, jobs).setNames;
                }
                return names.length === 0 ? (
                  <div className="text-sm text-slate-500 dark:text-slate-400">—</div>
                ) : (
                  <ul className="flex flex-wrap gap-2">
                    {names.map((sn) => {
                      const st = setStatusByName.get(sn) || null;
                      return (
                        <li
                          key={`lib-set-all-${showAllSetsForFileName}-${sn}`}
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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Library</h1>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-slate-200 dark:border-slate-600 overflow-hidden shrink-0">
            <button
              type="button"
              onClick={() => setLibraryView('files')}
              className={`px-3 py-1.5 text-xs font-semibold ${libraryView === 'files' ? 'bg-blue-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'}`}
            >
              Files
            </button>
            <button
              type="button"
              onClick={() => setLibraryView('rawTestCases')}
              className={`px-3 py-1.5 text-xs font-semibold ${libraryView === 'rawTestCases' ? 'bg-blue-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'}`}
            >
              Test Cases
            </button>
            <button
              type="button"
              onClick={() => setLibraryView('testCases')}
              className={`px-3 py-1.5 text-xs font-semibold ${libraryView === 'testCases' ? 'bg-blue-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'}`}
            >
              Sets
            </button>
          </div>
          {onNavigateToTestCases && (
            <button type="button" onClick={onNavigateToTestCases} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-sm font-medium hover:bg-slate-200 dark:hover:bg-slate-600">
              Go to Create Test Case <ChevronRight size={14} />
            </button>
          )}
        </div>
      </div>

      {libraryView === 'testCases' ? (
        /* Set Library (UI tab "Sets") — saved sets, per-set TC table, multi-select, remove-from-set trash */
        (() => {
          const selectedSetKeys = new Set(selectedLibrarySetTcKeys);
          const handleDeleteSelectedSetTcs = () => {
            if (selectedSetKeys.size === 0) {
              addToast({ type: 'info', message: 'Select test case(s) first' });
              return;
            }
            if (
              !window.confirm(
                `Remove ${selectedSetKeys.size} selected test case(s) from set(s) only?\n\nThis does not delete them from Test Case Library.`
              )
            ) {
              return;
            }
            const bySet = {};
            selectedSetKeys.forEach((key) => {
              const sep = key.indexOf('::');
              if (sep < 0) return;
              const setId = key.slice(0, sep);
              const idx = parseInt(key.slice(sep + 2), 10);
              if (Number.isNaN(idx)) return;
              if (!bySet[setId]) bySet[setId] = new Set();
              bySet[setId].add(idx);
            });
            let removed = 0;
            Object.entries(bySet).forEach(([setId, indices]) => {
              const set = (savedTestCaseSets || []).find((s) => s.id === setId);
              if (!set || !Array.isArray(set.items)) return;
              const setName = (set.name || '').trim() || 'Set';
              const st = (setStatusByName.get(setName) || '').toLowerCase();
              if (st === 'running' || st === 'pending') {
                addToast({ type: 'warning', message: `ลบจาก set ไม่ได้ — "${setName}" กำลัง ${st}` });
                return;
              }
              if (savedTestCaseSetPendingById?.[String(setId)]) {
                addToast({ type: 'warning', message: `ลบจาก set ไม่ได้ — "${setName}" กำลังมี action ค้าง` });
                return;
              }
              const canEdit = set._ownerId == null || String(set._ownerId) === String(activeProfileId);
              if (!canEdit) {
                addToast({ type: 'warning', message: `ลบจาก set ไม่ได้ — "${setName}" ไม่ใช่ set ของโปรไฟล์คุณ` });
                return;
              }
              const ok = removeSavedTestCaseSetRows(setId, indices);
              if (!ok) return;
              removed += indices.size;
              const after = useTestStore.getState().savedTestCaseSets.find((s) => s.id === setId);
              const allNames = new Set();
              (after?.items || []).forEach((tc) => {
                collectFileNamesFromTestCase(tc).forEach((n) => allNames.add(n));
              });
              const libFiles = Array.isArray(uploadedFiles) ? uploadedFiles : [];
              const fileIds = libFiles.filter((f) => allNames.has(f.name)).map((f) => f.id).filter(Boolean);
              if (fileIds.length > 0) {
                api.saveSetFiles(setId, fileIds).catch((err) => console.error('Save set files failed', err));
              }
            });
            setSelectedLibrarySetTcKeys([]);
            if (removed > 0) {
              addToast({ type: 'success', message: `นำออกจาก set แล้ว ${removed} รายการ (Library ยังอยู่)` });
            }
          };
          return (
            <div className="space-y-6">
              <div className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex flex-wrap items-center gap-3">
                <select
                  value={libraryCreatedByFilter}
                  onChange={(e) => setLibraryCreatedByFilter(e.target.value)}
                  className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800"
                  title="Mine = this profile only. All / Shared = load every profile’s sets from this server (GET /profiles/all-test-cases)."
                >
                  <option value="all">All</option>
                  <option value="mine">Mine</option>
                  <option value="shared">Shared with me</option>
                </select>
                <input type="text" value={librarySetTcNameFilter} onChange={(e) => setLibrarySetTcNameFilter(e.target.value)} placeholder="Filter by name" className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 w-40" />
                <input type="text" value={librarySetTcTagFilter} onChange={(e) => setLibrarySetTcTagFilter(e.target.value)} placeholder="Filter by tag" className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 w-32" />
                <select
                  value={librarySetTcStatusFilter}
                  onChange={(e) => setLibrarySetTcStatusFilter(e.target.value)}
                  className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800"
                >
                  <option value="all">All status</option>
                  <option value="pending">Pending</option>
                  <option value="running">Running</option>
                  <option value="completed">Completed</option>
                </select>
                <button type="button" onClick={handleDeleteSelectedSetTcs} disabled={selectedSetKeys.size === 0} className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-40 disabled:pointer-events-none transition-colors" title={selectedSetKeys.size > 0 ? `Remove ${selectedSetKeys.size} from set(s) only (not from Library)` : 'Select rows to remove from set'}>
                  <Trash2 size={18} strokeWidth={2} />
                </button>
                {selectedSetKeys.size > 0 && <span className="text-xs text-slate-500">{selectedSetKeys.size} selected</span>}
                <span className="text-xs text-slate-400">Click, Shift+click range, Ctrl/Cmd+click toggle, or drag to select. Trash removes from set only — Library unchanged.</span>
              </div>
              {libraryCreatedByFilter !== 'mine' && !globalTestCaseDataLoaded ? (
                <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 p-3 text-center text-xs text-slate-500 dark:text-slate-400">
                  Syncing server snapshot…
                </div>
              ) : null}
              {!(
                (libraryCreatedByFilter === 'mine'
                  ? savedTestCaseSets
                  : aggregateSavedTestCaseSetsAcrossProfiles()) || []
              )?.length ? (
                <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 p-8 text-center text-slate-500 dark:text-slate-400">
                  No sets yet — create test cases and Save Set on the Test Cases page
                </div>
              ) : (
                (libraryCreatedByFilter === 'mine'
                  ? (savedTestCaseSets || []).map((set) => ({
                      ...set,
                      _ownerId: activeProfileId,
                      _ownerName: resolveOwnerDisplayName(activeProfileId, ownerLabelCtx),
                    }))
                  : aggregateSavedTestCaseSetsAcrossProfiles().filter(
                      (set) =>
                        libraryCreatedByFilter !== 'shared' ||
                        (set._ownerId && set._ownerId !== activeProfileId)
                    )
                ).map((set, setIdx) => {
                  const items = Array.isArray(set.items) ? set.items : [];
                  const withMdi = (tc) => {
                    const cmds = Array.isArray(tc?.commands) ? tc.commands : [];
                    const names = [];
                    cmds
                      .filter((c) => c && c.type === 'mdi' && String(c.file || '').trim())
                      .forEach((c) => names.push(String(c.file).trim()));
                    const ex = tc?.extraColumns && typeof tc.extraColumns === 'object' ? tc.extraColumns : {};
                    const mdiKeys = Object.keys(ex).filter((k) => /^MDI\d+$/i.test(k));
                    mdiKeys
                      .sort((a, b) => {
                        const na = parseInt(String(a).match(/\d+/)?.[0] || '0', 10);
                        const nb = parseInt(String(b).match(/\d+/)?.[0] || '0', 10);
                        return na - nb;
                      })
                      .forEach((k) => {
                        const v = String(ex[k] || '').trim();
                        if (v && !names.includes(v)) names.push(v);
                      });
                    if (!names.length) return tc;
                    return { ...tc, mdiNames: names };
                  };
                  const itemsWithIndex = items.map((tc, i) => ({ ...withMdi(tc), _origIndex: i, _status: getTestCaseStatusFromJobs(tc) }));
                  const filteredItems = itemsWithIndex.filter((tc) => {
                    if (librarySetTcNameFilter.trim() && !(tc.name || '').toLowerCase().includes(librarySetTcNameFilter.trim().toLowerCase())) return false;
                    const tagVal = (tc.extraColumns && (tc.extraColumns.tag || tc.extraColumns.Tag)) || '';
                    if (librarySetTcTagFilter.trim() && !String(tagVal).toLowerCase().includes(librarySetTcTagFilter.trim().toLowerCase())) return false;
                    if (librarySetTcStatusFilter !== 'all') {
                      const status = tc._status || null;
                      if (!status) return false;
                      if (librarySetTcStatusFilter !== status) return false;
                    }
                    return true;
                  });
                  const allExtraColKeys = [...new Set(filteredItems.flatMap(getTcExtraColKeys))].sort();
                  const extraCols = allExtraColKeys
                    .filter((col) => !isExtraColumnHiddenFromLibraryTable(col))
                    .filter((col) => !/^MDI\d+$/i.test(col))
                    .filter((col) =>
                      filteredItems.some((t) => (getTcExtraColVal(t, col) ?? '').toString().trim() !== '')
                    );
                  const setName = set.name || `Set ${setIdx + 1}`;
                  const setStatusRaw = setStatusByName.get(setName) || null;
                  const setStatus = (setStatusRaw || '').toLowerCase();
                  const isSetLocked = setStatus === 'running' || setStatus === 'pending';
                  const setBusy = !!(savedTestCaseSetPendingById && savedTestCaseSetPendingById[String(set.id)]);
                  /** Row selection / remove-from-set: only block when the whole set is running/pending or saving — not per-TC job status (that would grey out checkboxes for unrelated runs). */
                  const isSetSelectionLocked = isSetLocked || setBusy;
                  const toggleSetTc = (key, rowIndex, e) => {
                    if (isSetSelectionLocked) return;
                    const last = lastClickedLibrarySetTcRef.current;
                    if (e.shiftKey && last.setId === set.id) {
                      const from = Math.min(last.index, rowIndex);
                      const to = Math.max(last.index, rowIndex);
                      const keysToAdd = filteredItems
                        .slice(from, to + 1)
                        .map((r) => `${set.id}::${r._origIndex}`);
                      setSelectedLibrarySetTcKeys((prev) => [...new Set([...prev, ...keysToAdd])]);
                      lastClickedLibrarySetTcRef.current = { setId: set.id, index: rowIndex };
                      return;
                    }
                    if (e.ctrlKey || e.metaKey) {
                      setSelectedLibrarySetTcKeys((prev) => (selectedSetKeys.has(key) ? prev.filter((k) => k !== key) : [...prev, key]));
                      lastClickedLibrarySetTcRef.current = { setId: set.id, index: rowIndex };
                      return;
                    }
                    // Simple click: toggle this row (multi-select — user can tick 3–4 items)
                    setSelectedLibrarySetTcKeys((prev) => (selectedSetKeys.has(key) ? prev.filter((k) => k !== key) : [...prev, key]));
                    lastClickedLibrarySetTcRef.current = { setId: set.id, index: rowIndex };
                  };
                  const rowKey = (tc) => `${set.id}::${tc._origIndex}`;
                  const setSelectedKeysInSet = filteredItems.filter((r) => selectedSetKeys.has(rowKey(r))).length;
                  const selectedRowKeysInThisSet = (selectedLibrarySetTcKeys || []).filter((k) =>
                    k.startsWith(`${set.id}::`)
                  ).length;
                  const canEditSet =
                    !isSetLocked &&
                    !setBusy &&
                    (set._ownerId == null || String(set._ownerId) === String(activeProfileId));
                  return (
                    <div key={set.id} className={`bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden ${setBusy ? 'ring-1 ring-amber-400/50 dark:ring-amber-500/40' : ''}`}>
                      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-600 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <h2 className="text-sm font-bold text-slate-700 dark:text-slate-200">
                            {setName}
                            <span className="ml-2 text-xs font-normal text-slate-500">
                              ({filteredItems.length} test case{filteredItems.length !== 1 ? 's' : ''}{filteredItems.length !== items.length ? `, filtered from ${items.length}` : ''})
                            </span>
                          </h2>
                          {setStatus && (
                            <span
                              className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
                                setStatus === 'running'
                                  ? 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/40 dark:text-blue-200 dark:border-blue-700'
                                  : setStatus === 'pending'
                                  ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/40 dark:text-amber-200 dark:border-amber-700'
                                  : 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-600'
                              }`}
                            >
                              {setStatus.charAt(0).toUpperCase() + setStatus.slice(1)}
                            </span>
                          )}
                          
                          {(() => {
                            const raw = (set.tag || '').trim();
                            if (!raw) return null;
                            const tags = splitTagsComma(raw);
                            if (!tags.length) return null;
                            const colors = normalizeTagColorList(
                              { tagColor: set.tagColor, tagColorList: set.tagColorList },
                              tags.length
                            );
                            return (
                              <div className="flex flex-wrap items-center gap-1.5 ml-1">
                                {tags.map((t, ti) => (
                                  <span
                                    key={`${set.id}-settag-${ti}`}
                                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border ${jobTagPillClasses(colors[ti])}`}
                                    title="Tag set (same as Run Set / job tag when synced)"
                                  >
                                    {t}
                                  </span>
                                ))}
                              </div>
                            );
                          })()}
                        </div>
                        <div className="flex items-center gap-2">
                          {setSelectedKeysInSet > 0 && (
                            <span className="text-xs text-slate-500">{setSelectedKeysInSet} selected</span>
                          )}
                          {canEditSet && (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  if (setBusy) return;
                                  setAddTcsToSetModalSetId(set.id);
                                  setAddTcsToSetSelectedIds([]);
                                  setAddTcsPickerNameQ('');
                                  setAddTcsPickerTagQ('');
                                  setAddTcsPickerOwnerQ('');
                                  setAddTcsPickerTimeQ('');
                                }}
                                className="p-1.5 rounded text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border border-transparent hover:border-slate-200 dark:hover:border-slate-600"
                                title="เพิ่ม test case จาก Library เข้า set นี้"
                                aria-label="Add test cases from library to this set"
                              >
                                <Pencil size={14} strokeWidth={2} />
                              </button>
                              <span className="w-px h-6 bg-slate-200 dark:bg-slate-700 mx-1" aria-hidden />
                            </>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              if (setBusy) return;
                              if (isSetLocked) {
                                addToast({ type: 'warning', message: 'Set นี้กำลัง running/pending — ยัง run ซ้ำไม่ได้' });
                                return;
                              }
                              void runSavedSetNow(set);
                            }}
                            disabled={isSetLocked || setBusy}
                            className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-semibold ${
                              isSetLocked || setBusy
                                ? 'bg-slate-200 dark:bg-slate-700 text-slate-400 cursor-not-allowed'
                                : 'bg-emerald-600 text-white hover:bg-emerald-700'
                            }`}
                            title={setBusy ? 'กำลังลบ/สำเนา/จัดเรียง set — รอสักครู่' : isSetLocked ? 'Set นี้กำลัง running/pending' : 'Run this set now'}
                          >
                            <Play size={12} />
                            Run
                          </button>
                          <span className="w-px h-6 bg-slate-200 dark:bg-slate-700 mx-1" aria-hidden />
                          <button
                            type="button"
                            onClick={async () => {
                              if (setBusy) return;
                              if (isSetLocked) {
                                addToast({ type: 'warning', message: 'Set กำลังรันหรือรอคิว — ไม่สามารถลบได้จนกว่าจะจบ process' });
                                return;
                              }
                              const selectedIndicesInThisSet = new Set();
                              (selectedLibrarySetTcKeys || []).forEach((k) => {
                                if (!k.startsWith(`${set.id}::`)) return;
                                const sep = k.indexOf('::');
                                const idx = parseInt(k.slice(sep + 2), 10);
                                if (!Number.isNaN(idx)) selectedIndicesInThisSet.add(idx);
                              });
                              const removeSelectedOnly = selectedIndicesInThisSet.size > 0;
                              if (removeSelectedOnly) {
                                if (!canEditSet) {
                                  addToast({
                                    type: 'warning',
                                    message:
                                      set._ownerId != null && String(set._ownerId) !== String(activeProfileId)
                                        ? 'แก้ได้เฉพาะ set ของโปรไฟล์คุณ'
                                        : 'ไม่สามารถนำออกได้ขณะ set ถูกล็อก',
                                  });
                                  return;
                                }
                                if (
                                  !window.confirm(
                                    `นำ ${selectedIndicesInThisSet.size} test case ที่เลือกออกจาก set "${setName}" เท่านั้น?\n\nไม่ลบจาก Test Case Library`
                                  )
                                ) {
                                  return;
                                }
                                const ok = removeSavedTestCaseSetRows(set.id, selectedIndicesInThisSet);
                                if (!ok) return;
                                setSelectedLibrarySetTcKeys((prev) => prev.filter((k) => !k.startsWith(`${set.id}::`)));
                                const after = useTestStore.getState().savedTestCaseSets.find((s) => s.id === set.id);
                                const allNames = new Set();
                                (after?.items || []).forEach((tc) => {
                                  collectFileNamesFromTestCase(tc).forEach((n) => allNames.add(n));
                                });
                                const libFiles = Array.isArray(uploadedFiles) ? uploadedFiles : [];
                                const fileIds = libFiles.filter((f) => allNames.has(f.name)).map((f) => f.id).filter(Boolean);
                                if (fileIds.length > 0) {
                                  api.saveSetFiles(set.id, fileIds).catch((err) => console.error('Save set files failed', err));
                                }
                                addToast({
                                  type: 'success',
                                  message: `นำออกจาก set "${setName}" แล้ว (${selectedIndicesInThisSet.size} รายการ) — Library ยังอยู่`,
                                });
                                return;
                              }
                              if (!window.confirm(`Delete set "${setName}"? This will remove it from Saved sets only (test cases and files in Library will stay).`)) return;
                              try {
                                await api.deleteSet(set.id);
                              } catch (e) {
                                if (!String(e?.message || '').includes('404')) addToast({ type: 'warning', message: `Backend: ${e?.message || 'Delete failed'}` });
                              }
                              removeSavedTestCaseSet(set.id);
                              setSelectedLibrarySetTcKeys((prev) => prev.filter((k) => !k.startsWith(set.id + '::')));
                              addToast({ type: 'success', message: `Deleted set "${setName}"` });
                            }}
                            disabled={isSetLocked || setBusy}
                            className={`p-1.5 rounded ${isSetLocked || setBusy ? 'opacity-50 cursor-not-allowed text-slate-400' : 'hover:bg-red-600/10 text-red-600 dark:text-red-400'}`}
                            title={
                              setBusy
                                ? 'กำลังลบ/สำเนา/จัดเรียง — รอสักครู่'
                                : isSetLocked
                                  ? 'Cannot delete — Set is running/pending'
                                  : selectedRowKeysInThisSet > 0
                                    ? `นำ test case ที่เลือกออกจาก set นี้เท่านั้น (${selectedRowKeysInThisSet} selected) — ไม่ลบ Library`
                                    : 'Delete entire set from Saved (ไม่ลบ test cases หรือไฟล์ใน Library)'
                            }
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                      <div className="overflow-x-auto table-scroll-smooth" style={{ scrollBehavior: 'smooth', WebkitOverflowScrolling: 'touch' }}>
                        <table className="w-full text-sm min-w-max">
                          <thead>
                            <tr className="bg-slate-100 dark:bg-slate-800 text-left text-xs font-bold text-slate-600 dark:text-slate-400">
                              <th className="w-9 px-2 py-2 border-r border-slate-200 dark:border-slate-600">#</th>
                              <th className="w-8 px-2 py-2 border-r border-slate-200 dark:border-slate-600">#</th>
                              <th className="min-w-[120px] px-2 py-2 border-r border-slate-200 dark:border-slate-600">Name</th>
                              <th className="w-24 px-2 py-2 border-r border-slate-200 dark:border-slate-600" title="Owner">Owner</th>
                              <th className="w-10 px-2 py-2 border-r border-slate-200 dark:border-slate-600 text-center" title="Visibility">Vis</th>
                              <th className="min-w-[168px] px-2 py-2 border-r border-slate-200 dark:border-slate-600">Tag</th>
                              <th className="w-24 px-2 py-2 border-r border-slate-200 dark:border-slate-600 text-center">Date</th>
                              <th className="min-w-[100px] px-2 py-2 border-r border-slate-200 dark:border-slate-600">ERoM</th>
                              <th className="min-w-[100px] px-2 py-2 border-r border-slate-200 dark:border-slate-600">ULP</th>
                              <th className="min-w-[100px] px-2 py-2 border-r border-slate-200 dark:border-slate-600">VCD</th>
                              <th className="min-w-[140px] px-2 py-2 border-r border-slate-200 dark:border-slate-600">MDI (text)</th>
                              {extraCols.map((col) => (<th key={col} className="px-2 py-2 border-r border-slate-200 dark:border-slate-600 min-w-[90px] whitespace-nowrap">{col}</th>))}
                              <th className="w-14 px-2 py-2 border-r border-slate-200 dark:border-slate-600 text-center">Try</th>
                              <th className="w-20 px-2 py-2 border-r border-slate-200 dark:border-slate-600 text-center">Status</th>
                              <th className="w-20 px-2 py-2 border-r border-slate-200 dark:border-slate-600 text-center">Edit</th>
                              <th className="w-20 px-2 py-2 border-r border-slate-200 dark:border-slate-600 text-center">History</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredItems.length === 0 ? (
                              <tr>
                                <td colSpan={15 + extraCols.length} className="px-2 py-4 text-center text-slate-400 text-xs">No test cases in this set{items.length > 0 ? ' (or no match for filter)' : ''}</td>
                              </tr>
                            ) : (
                              filteredItems.map((tc, idx) => {
                                const key = rowKey(tc);
                                const isSelected = selectedSetKeys.has(key);
                                const isClosed = isTcManuallyClosed(tc);
                                  const isSystemLocked = isTcSystemLocked(tc);
                                const historyCount = getTestCaseHistory(tc).length;
                                return (
                                  <tr
                                    key={key}
                                      className={`border-b border-slate-100 dark:border-slate-700 cursor-pointer select-none ${
                                        isSetSelectionLocked
                                          ? 'opacity-70 bg-slate-50 dark:bg-slate-800/50 cursor-not-allowed'
                                          : ''
                                      } ${isSelected ? 'bg-blue-50 dark:bg-blue-900/20' : !isSetSelectionLocked ? 'hover:bg-slate-50 dark:hover:bg-slate-800/50' : ''}`}
                                    onClick={(e) => {
                                      if (e.target.closest('input[type="checkbox"]') || e.target.closest('button')) return;
                                        if (isSetSelectionLocked) return;
                                      toggleSetTc(key, idx, e);
                                    }}
                                    title="Set Library — เลือกแถวแล้วกดไอคอนถังข้างบนเพื่อนำออกจาก set (ไม่ลบ Library)"
                                    onMouseDown={(e) => {
                                        if (e.target.closest('input[type="checkbox"]') || e.target.closest('button') || isSetSelectionLocked) return;
                                      if (e.button === 0) {
                                        isDragSelectingLibrarySetRef.current = true;
                                        if (!selectedSetKeys.has(key)) setSelectedLibrarySetTcKeys((prev) => [...prev, key]);
                                      }
                                    }}
                                      onMouseEnter={() => {
                                        if (!isDragSelectingLibrarySetRef.current || isSetSelectionLocked) return;
                                        if (!selectedSetKeys.has(key)) setSelectedLibrarySetTcKeys((prev) => [...prev, key]);
                                      }}
                                  >
                                    <td className="px-2 py-2 border-r border-slate-100 dark:border-slate-700" onClick={(e) => e.stopPropagation()}>
                                      <input
                                        type="checkbox"
                                        checked={isSelected}
                                        disabled={isSetSelectionLocked}
                                        onChange={() => {
                                          if (isSetSelectionLocked) return;
                                          toggleSetTc(key, idx, { shiftKey: false, ctrlKey: false, metaKey: false });
                                        }}
                                        className={`w-4 h-4 rounded ${isSetSelectionLocked ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
                                      />
                                    </td>
                                    <td className="px-2 py-2 border-r border-slate-100 dark:border-slate-700 text-slate-500">{idx + 1}</td>
                                    <td className="px-2 py-2 border-r border-slate-100 dark:border-slate-700 font-medium text-slate-800 dark:text-slate-200">{tc.name || '—'}</td>
                                    <td
                                      className="px-2 py-2 border-r border-slate-100 dark:border-slate-700 text-xs text-slate-500 dark:text-slate-400 truncate max-w-[80px]"
                                      title={resolveOwnerDisplayName(set._ownerId ?? activeProfileId, ownerLabelCtx)}
                                    >
                                      {resolveOwnerDisplayName(set._ownerId ?? activeProfileId, ownerLabelCtx)}
                                    </td>
                                    <td className="px-2 py-2 border-r border-slate-100 dark:border-slate-700 text-center">
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                            if (isSystemLocked) {
                                              addToast({
                                                type: 'warning',
                                                message: ' Test case is locked by system (running/pending) — cannot change visibility',
                                              });
                                              return;
                                            }
                                          updateTcVisibility({ ...tc, _source: 'set', _setId: set.id, _itemIndex: tc._origIndex }, !isClosed);
                                          setSelectedLibrarySetTcKeys((prev) => prev.filter((k) => k !== key));
                                        }}
                                          className={`inline-flex items-center justify-center p-1 rounded ${
                                            isSystemLocked
                                              ? 'text-blue-500 hover:bg-blue-500/10 cursor-not-allowed'
                                              : isClosed
                                                ? 'text-amber-500 hover:bg-amber-500/10'
                                                : 'text-slate-400 hover:bg-slate-500/10'
                                          }`}
                                          title={
                                            isSystemLocked
                                              ? 'Locked by system (running/pending) — system lock'
                                              : isClosed
                                                ? 'Closed — click to open/selectable'
                                                : 'Open — click to close/lock from select all'
                                          }
                                      >
                                          {isSystemLocked ? <Lock size={14} /> : isClosed ? <Lock size={14} /> : <Globe size={14} />}
                                      </button>
                                    </td>
                                    <td className="px-2 py-2 border-r border-slate-100 dark:border-slate-700 min-w-[160px]">
                                      {(() => {
                                        const rawTag = (tc.extraColumns && (tc.extraColumns.tag || tc.extraColumns.Tag)) || '';
                                        const tags = splitTags(rawTag);
                                        if (!tags.length) {
                                          return <span className="text-slate-400 text-xs">No tag</span>;
                                        }
                                        const colors = normalizeTagColorList(tc.extraColumns || {}, tags.length);
                                        const firstClass = TAG_PALETTE_MAP[colors[0]] || TAG_PALETTE_MAP.mint;
                                        const more = tags.length > 1;
                                        return (
                                          <div className="flex flex-wrap items-center gap-1 min-w-0">
                                            <span
                                              className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border ${firstClass}`}
                                              title={tags[0]}
                                            >
                                              <span className="max-w-[160px] truncate">{tags[0]}</span>
                                            </span>
                                            {more ? (
                                              <span className="text-[11px] text-slate-400" title={tags.join(', ')}>
                                                … +{tags.length - 1}
                                              </span>
                                            ) : null}
                                          </div>
                                        );
                                      })()}
                                    </td>
                                    <td className="px-2 py-2 border-r border-slate-100 dark:border-slate-700 text-center text-slate-500 dark:text-slate-400 text-xs">{(tc.updatedAt || tc.createdAt) ? new Date(tc.updatedAt || tc.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—'}</td>
                                    <td className="px-2 py-2 border-r border-slate-100 dark:border-slate-700 text-slate-600 dark:text-slate-300">
                                      {tc.binName ? (
                                        <button
                                          type="button"
                                          onClick={(e) => { e.stopPropagation(); focusFileInLibrary(tc.binName); }}
                                          className="text-xs text-blue-600 dark:text-blue-400 hover:underline hover:text-blue-700 dark:hover:text-blue-300"
                                          title="View this file in File in Library"
                                        >
                                          {tc.binName}
                                        </button>
                                      ) : (
                                        '—'
                                      )}
                                    </td>
                                    <td className="px-2 py-2 border-r border-slate-100 dark:border-slate-700 text-slate-600 dark:text-slate-300">
                                      {tc.linName ? (
                                        <button
                                          type="button"
                                          onClick={(e) => { e.stopPropagation(); focusFileInLibrary(tc.linName); }}
                                          className="text-xs text-blue-600 dark:text-blue-400 hover:underline hover:text-blue-700 dark:hover:text-blue-300"
                                          title="View this file in File in Library"
                                        >
                                          {tc.linName}
                                        </button>
                                      ) : (
                                        '—'
                                      )}
                                    </td>
                                    <td className="px-2 py-2 border-r border-slate-100 dark:border-slate-700 text-slate-600 dark:text-slate-300">
                                      {tc.vcdName ? (
                                        <button
                                          type="button"
                                          onClick={(e) => { e.stopPropagation(); focusFileInLibrary(tc.vcdName); }}
                                          className="text-xs text-blue-600 dark:text-blue-400 hover:underline hover:text-blue-700 dark:hover:text-blue-300"
                                          title="View this file in File in Library"
                                        >
                                          {tc.vcdName}
                                        </button>
                                      ) : (
                                        '—'
                                      )}
                                    </td>
                                    <td
                                      className="px-2 py-2 border-r border-slate-100 dark:border-slate-700 text-slate-600 dark:text-slate-300 truncate max-w-[180px]"
                                      title={Array.isArray(tc.mdiNames) && tc.mdiNames.length > 0 ? tc.mdiNames.join(', ') : undefined}
                                    >
                                      {Array.isArray(tc.mdiNames) && tc.mdiNames.length > 0 ? (
                                        tc.mdiNames.map((name, idx2) => (
                                          <span key={String(name)}>
                                            <button
                                              type="button"
                                              onClick={(e) => { e.stopPropagation(); focusFileInLibrary(String(name)); }}
                                              className="text-xs text-blue-600 dark:text-blue-400 hover:underline hover:text-blue-700 dark:hover:text-blue-300"
                                              title="View this file in File in Library"
                                            >
                                              {String(name)}
                                            </button>
                                            {idx2 < tc.mdiNames.length - 1 ? ', ' : ''}
                                          </span>
                                        ))
                                      ) : (
                                        <span className="text-slate-400">—</span>
                                      )}
                                    </td>
                                    {extraCols.map((col) => (
                                      <td
                                        key={col}
                                        className="px-2 py-2 border-r border-slate-100 dark:border-slate-700 text-slate-600 dark:text-slate-300 min-w-[90px] truncate max-w-[140px]"
                                        title={getTcExtraColVal(tc, col) || undefined}
                                      >
                                        {(() => {
                                          const val = getTcExtraColVal(tc, col);
                                          if (!val) return '—';
                                          const isFileCol =
                                            /^VCD\d+$/i.test(col) ||
                                            /^ERoM\d+$/i.test(col) ||
                                            /^ULP\d+$/i.test(col) ||
                                            /^MDI\d+$/i.test(col);
                                          if (!isFileCol) return val;
                                          return (
                                            <button
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                focusFileInLibrary(String(val));
                                              }}
                                              className="text-xs text-blue-600 dark:text-blue-400 hover:underline hover:text-blue-700 dark:hover:text-blue-300"
                                              title="View this file in File in Library"
                                            >
                                              {val}
                                            </button>
                                          );
                                        })()}
                                      </td>
                                    ))}
                                    <td className="px-2 py-2 border-r border-slate-100 dark:border-slate-700 text-center text-slate-600 dark:text-slate-400">{typeof tc.tryCount === 'number' && tc.tryCount > 0 ? tc.tryCount : 1}</td>
                                    <td className="px-2 py-2 border-r border-slate-100 dark:border-slate-700 text-center">
                                      {(() => {
                                        const status = tc._status || null;
                                        if (status === 'running') {
                                          return (
                                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 border border-blue-200 text-[10px] font-semibold" title="Running in current set(s)">
                                              Running
                                            </span>
                                          );
                                        }
                                        if (status === 'pending') {
                                          return (
                                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-yellow-100 text-yellow-700 border border-yellow-200 text-[10px] font-semibold" title="Pending in run queue">
                                              Pending
                                            </span>
                                          );
                                        }
                                        if (status === 'completed') {
                                          return (
                                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200 text-[10px] font-semibold" title="Completed in past run(s)">
                                              Completed
                                            </span>
                                          );
                                        }
                                        return <span className="text-slate-400 dark:text-slate-500 text-[10px]">—</span>;
                                      })()}
                                    </td>
                                    <td className="px-2 py-2 border-r border-slate-100 dark:border-slate-700 text-center">
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          if (isClosed || isSystemLocked) return;
                                          if (onNavigateToTestCases && setLibraryEditContext) {
                                            setLibraryEditContext({ loadSetId: set.id, focusTcIndex: tc._origIndex });
                                            onNavigateToTestCases();
                                          }
                                        }}
                                        disabled={isClosed || isSystemLocked}
                                        className={`inline-flex items-center justify-center p-1.5 rounded-lg transition-colors ${
                                          isClosed || isSystemLocked
                                            ? 'text-slate-300 dark:text-slate-600 cursor-not-allowed'
                                            : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                                        }`}
                                        title={isClosed || isSystemLocked ? 'Locked — cannot edit' : 'Edit in Test Cases page'}
                                      >
                                        <Pencil size={16} />
                                      </button>
                                    </td>
                                    <td className="px-2 py-2 border-r border-slate-100 dark:border-slate-700 text-center">
                                      <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); setTestCaseHistoryFor({ tc }); }}
                                        className="inline-flex items-center justify-center gap-1 px-1.5 py-1 rounded text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                                        title="View job/set history for this test case"
                                      >
                                        <History size={14} />
                                        {historyCount > 0 && <span className="text-[10px] font-medium">{historyCount}</span>}
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          );
        })()
      ) : libraryView === 'rawTestCases' ? (
        /* Raw Test Cases — filter name/tag, multi-select (shift/ctrl + drag), delete selected */
        (() => {
          const selectedSet = new Set(selectedLibraryTcKeys);
          // Allow selecting Running/Pending rows so users can send them to Run Set.
          // Still block selection for manually closed rows and block destructive actions separately.
          const isTcSelectionDisabled = (row) => Boolean(row && isTcManuallyClosed(row));
          const isTcEditingLocked = (row) =>
            Boolean(row && (row._status === 'running' || row._status === 'pending' || isTcManuallyClosed(row)));
          const selectableTcKeys = libraryFilteredRows
            .filter((r) => !isTcSelectionDisabled(r))
            .map((r) => r._key)
            .filter(Boolean);
          const hasRunningOrPendingInSelection = libraryFilteredRows.some(
            (r) => selectedSet.has(r._key) && (r._status === 'running' || r._status === 'pending'),
          );
          const hasStorePendingInSelection = libraryFilteredRows.some(
            (r) =>
              selectedSet.has(r._key) &&
              r._source === 'current' &&
              r.id &&
              testCasePendingById?.[String(r.id)],
          );
          const getExtraColKeys = (t) => {
            const fromExtra = Object.keys(t.extraColumns || {});
            const fromCmds = [];
            (t.commands || []).filter((c) => c.type === 'vcd' && (c.file || '').trim()).forEach((_, i) => fromCmds.push(`VCD${i + 2}`));
            (t.commands || []).filter((c) => c.type === 'erom' && (c.file || '').trim()).forEach((_, i) => fromCmds.push(`ERoM${i + 2}`));
            (t.commands || []).filter((c) => c.type === 'ulp' && (c.file || '').trim()).forEach((_, i) => fromCmds.push(`ULP${i + 2}`));
            (t.commands || []).filter((c) => c.type === 'mdi').forEach((_, i) => fromCmds.push(`MDI${i + 1}`));
            return [...fromExtra, ...fromCmds];
          };
          const getExtraVal = (t, col) => {
            const m = col.match(/^VCD(\d+)$/);
            if (m) {
              const idx = parseInt(m[1], 10) - 2;
              const vcds = (t.commands || []).filter((c) => c.type === 'vcd' && (c.file || '').trim());
              return vcds[idx]?.file ?? t.extraColumns?.[col] ?? '';
            }
            const m2 = col.match(/^ERoM(\d+)$/);
            if (m2) {
              const idx = parseInt(m2[1], 10) - 2;
              const eroms = (t.commands || []).filter((c) => c.type === 'erom' && (c.file || '').trim());
              return eroms[idx]?.file ?? t.extraColumns?.[col] ?? '';
            }
            const m3 = col.match(/^ULP(\d+)$/);
            if (m3) {
              const idx = parseInt(m3[1], 10) - 2;
              const ulps = (t.commands || []).filter((c) => c.type === 'ulp' && (c.file || '').trim());
              return ulps[idx]?.file ?? t.extraColumns?.[col] ?? '';
            }
            const m4 = col.match(/^MDI(\d+)$/);
            if (m4) {
              const idx = parseInt(m4[1], 10) - 1;
              const mdis = (t.commands || []).filter((c) => c.type === 'mdi');
              return mdis[idx]?.file ?? t.extraColumns?.[col] ?? '';
            }
            return t.extraColumns?.[col] ?? '';
          };
         const allCols = [...new Set(libraryFilteredRows.flatMap(getExtraColKeys))].sort();
         const extraCols = allCols
           .filter((col) => !isExtraColumnHiddenFromLibraryTable(col))
           .filter((col) => !/^MDI\d+$/i.test(col))
           .filter((col) => libraryFilteredRows.some((t) => (getExtraVal(t, col) ?? '').toString().trim() !== ''));
          const toggleSelect = (key, idx, e) => {
            const row = libraryFilteredRows[idx];
            if (row && isTcSelectionDisabled(row)) return;
            if (e.shiftKey) {
              const last = lastClickedLibraryTcIndexRef.current;
              const from = last != null ? Math.min(last, idx) : idx;
              const to = last != null ? Math.max(last, idx) : idx;
              const keysToAdd = libraryFilteredRows
                .slice(from, to + 1)
                .filter((r) => !isTcSelectionDisabled(r))
                .map((r) => r._key)
                .filter(Boolean);
              setSelectedLibraryTcKeys((prev) => [...new Set([...prev, ...keysToAdd])]);
              lastClickedLibraryTcIndexRef.current = idx;
              return;
            }
            if (e.ctrlKey || e.metaKey) {
              setSelectedLibraryTcKeys((prev) =>
                selectedSet.has(key) ? prev.filter((k) => k !== key) : [...prev, key]
              );
              lastClickedLibraryTcIndexRef.current = idx;
              return;
            }
            setSelectedLibraryTcKeys((prev) =>
              selectedSet.has(key) ? prev.filter((k) => k !== key) : [...prev, key]
            );
            lastClickedLibraryTcIndexRef.current = idx;
          };
          const handleRowMouseDown = (key, idx) => {
            const row = libraryFilteredRows[idx];
            if (row && isTcSelectionDisabled(row)) return;
            isDragSelectingLibraryRef.current = true;
            if (!selectedSet.has(key)) setSelectedLibraryTcKeys((prev) => [...prev, key]);
          };
          const handleRowMouseEnter = (key, idx) => {
            const row = libraryFilteredRows[idx];
            if (row && isTcSelectionDisabled(row)) return;
            if (!isDragSelectingLibraryRef.current) return;
            if (!selectedSet.has(key)) setSelectedLibraryTcKeys((prev) => [...prev, key]);
          };
          const handleDeleteSelected = () => {
            if (selectedSet.size === 0) {
              addToast({ type: 'info', message: 'Select test case(s) first' });
              return;
            }
            if (hasStorePendingInSelection) {
              addToast({ type: 'info', message: 'Please wait for the current action to finish on the selected test case(s).' });
              return;
            }
            if (hasRunningOrPendingInSelection) {
              addToast({ type: 'warning', message: 'Test case are running/pending — cannot be deleted until process is finished' });
              return;
            }
            const toRemove = libraryRawRows
              .filter((r) => r._key && selectedSet.has(r._key))
              .filter((r) => !isTcSelectionDisabled(r));
            if (!window.confirm(`Delete ${toRemove.length} selected test case(s)?`)) return;

            const bySet = {};
            toRemove.forEach((row) => {
              // Library item: remove from Test Case Library
              if (row._source === 'current' && row.id) {
                removeSavedTestCase(row.id);
                return;
              }

              // Set item: remove from that set only (do NOT delete library item)
              if (row._source === 'set' && row._setId != null && row._itemIndex != null) {
                if (!bySet[row._setId]) bySet[row._setId] = new Set();
                bySet[row._setId].add(row._itemIndex);
              }
            });

            Object.entries(bySet).forEach(([setId, indices]) => {
              const set = (savedTestCaseSets || []).find((s) => s.id === setId);
              if (!set || !Array.isArray(set.items)) return;
              const newItems = set.items.filter((_, i) => !indices.has(i));
              updateSavedTestCaseSet(setId, { items: newItems });
            });

            setSelectedLibraryTcKeys([]);
            addToast({ type: 'success', message: `Deleted ${toRemove.length} test case(s)` });
          };
          const handleSendSelectedToRunSet = () => {
            if (selectedSet.size === 0) {
              addToast({ type: 'info', message: 'Select test case(s) first' });
              return;
            }
            if (!onNavigateToRunSet || !setRunSetImportContext) return;
            const byKey = new Map(libraryRawRows.filter((r) => r._key).map((r) => [r._key, r]));
            const orderedKeys = selectedLibraryTcKeys.filter((k) => selectedSet.has(k) && byKey.has(k));
            const rows = orderedKeys
              .map((k) => byKey.get(k))
              .filter(Boolean)
              .map((row) => ({
                name: (row.name || '').trim(),
                vcdName: row.vcdName || '',
                binName: row.binName || '',
                linName: row.linName || '',
                tryCount: typeof row.tryCount === 'number' && row.tryCount > 0 ? row.tryCount : 1,
                extraColumns: row.extraColumns && typeof row.extraColumns === 'object' ? { ...row.extraColumns } : {},
                createdAt: row.createdAt || new Date().toISOString(),
                updatedAt: row.updatedAt || row.createdAt || new Date().toISOString(),
              }));
            if (!rows.length) {
              addToast({ type: 'warning', message: 'ไม่พบ test case ที่เลือก' });
              return;
            }
            setRunSetImportContext({
              items: rows,
              name: `Selected ${rows.length} test case(s)`,
            });
            onNavigateToRunSet();
            addToast({ type: 'success', message: `Sent ${rows.length} test case(s) to Run Set` });
          };
          return (
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-600">
                
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  
                </p>
              </div>
              <div className="px-4 py-2 border-b border-slate-100 dark:border-slate-700 flex flex-wrap items-center gap-3">
                <select
                  value={libraryCreatedByFilter}
                  onChange={(e) => setLibraryCreatedByFilter(e.target.value)}
                  className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800"
                  title="Mine = this profile only. All / Shared = load every profile’s saved test cases from this server (GET /profiles/all-test-cases)."
                >
                  <option value="all">All</option>
                  <option value="mine">Mine</option>
                  <option value="shared">Shared with me</option>
                </select>
                <input
                  type="text"
                  value={libraryTcNameFilter}
                  onChange={(e) => setLibraryTcNameFilter(e.target.value)}
                  placeholder="Filter by name"
                  className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 w-40"
                />
                <input
                  type="text"
                  value={libraryTcTagFilter}
                  onChange={(e) => setLibraryTcTagFilter(e.target.value)}
                  placeholder="Filter by tag"
                  className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 w-32"
                />
                <select
                  value={libraryTcStatusFilter}
                  onChange={(e) => setLibraryTcStatusFilter(e.target.value)}
                  className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800"
                >
                  <option value="all">All status</option>
                  <option value="pending">Pending</option>
                  <option value="running">Running</option>
                  <option value="completed">Completed</option>
                </select>
                <button
                  type="button"
                  onClick={handleDeleteSelected}
                  disabled={selectedSet.size === 0 || hasRunningOrPendingInSelection || hasStorePendingInSelection}
                  className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-40 disabled:pointer-events-none transition-colors"
                  title={hasStorePendingInSelection ? 'รอให้ action กับ test case ที่เลือกจบก่อน' : hasRunningOrPendingInSelection ? 'Cannot delete — running/pending test cases' : selectedSet.size > 0 ? `Delete ${selectedSet.size} selected` : 'Select test cases to delete'}
                >
                  <Trash2 size={18} strokeWidth={2} />
                </button>
                {onNavigateToRunSet && (
                  <button
                    type="button"
                    onClick={handleSendSelectedToRunSet}
                    disabled={selectedSet.size === 0}
                    className="ml-auto inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 disabled:pointer-events-none transition-colors"
                    title={selectedSet.size > 0 ? `Send ${selectedSet.size} selected to Run Set` : 'Select test cases to send'}
                  >
                    Send to Run Set
                  </button>
                )}
                {selectedSet.size > 0 && (
                  <span className="text-xs text-slate-500">{selectedSet.size} selected{hasRunningOrPendingInSelection ? ' (มีรายการที่ล็อก)' : ''}</span>
                )}
              </div>
              <div className="flex flex-col xl:flex-row gap-4 px-4 pb-4 xl:items-start">
                {libraryCreatedByFilter !== 'mine' && !globalTestCaseDataLoaded && (
                  <div className="w-full text-xs text-amber-600 dark:text-amber-400 px-1">
                    Syncing server snapshot… (local + server rows shown)
                  </div>
                )}
                <div className="flex-1 min-w-0 overflow-x-auto overflow-y-visible rounded-b-xl table-scroll-smooth" style={{ scrollBehavior: 'smooth', WebkitOverflowScrolling: 'touch' }}>
                <table className="w-full text-sm min-w-max">
                  <thead>
                    <tr className="bg-slate-100 dark:bg-slate-800 text-left text-xs font-bold text-slate-600 dark:text-slate-400">
                      <th className="w-9 px-2 py-2 border-r border-slate-200 dark:border-slate-600 sticky left-0 bg-slate-100 dark:bg-slate-800 z-10">
                        <input
                          type="checkbox"
                          checked={selectableTcKeys.length > 0 && selectableTcKeys.every((k) => selectedSet.has(k))}
                          onChange={(e) => {
                            if (e.target.checked) setSelectedLibraryTcKeys([...selectableTcKeys]);
                            else setSelectedLibraryTcKeys([]);
                          }}
                          className="w-4 h-4 rounded cursor-pointer"
                          title="Select all"
                        />
                      </th>
                      <th className="w-8 px-2 py-2 border-r border-slate-200 dark:border-slate-600">#</th>
                      <th className="min-w-[120px] px-2 py-2 border-r border-slate-200 dark:border-slate-600">Name</th>
                      <th className="w-24 px-2 py-2 border-r border-slate-200 dark:border-slate-600" title="Owner">Owner</th>
                      <th className="w-10 px-2 py-2 border-r border-slate-200 dark:border-slate-600 text-center" title="Visibility">Vis</th>
                      <th className="min-w-[168px] px-2 py-2 border-r border-slate-200 dark:border-slate-600">Tag</th>
                      <th className="w-24 px-2 py-2 border-r border-slate-200 dark:border-slate-600 text-center">Date</th>
                      <th className="min-w-[100px] px-2 py-2 border-r border-slate-200 dark:border-slate-600">ERoM</th>
                      <th className="min-w-[100px] px-2 py-2 border-r border-slate-200 dark:border-slate-600">ULP</th>
                      <th className="min-w-[100px] px-2 py-2 border-r border-slate-200 dark:border-slate-600">VCD</th>
                      <th className="min-w-[140px] px-2 py-2 border-r border-slate-200 dark:border-slate-600">MDI (text)</th>
                      {extraCols.map((col) => (
                        <th key={col} className="px-2 py-2 border-r border-slate-200 dark:border-slate-600 min-w-[90px] whitespace-nowrap">{col}</th>
                      ))}
                      <th className="w-14 px-2 py-2 border-r border-slate-200 dark:border-slate-600 text-center">Try</th>
                      <th className="w-24 px-2 py-2 border-r border-slate-200 dark:border-slate-600 text-center">Status</th>
                      <th className="w-20 px-2 py-2 border-r border-slate-200 dark:border-slate-600 text-center">Edit</th>
                      <th className="w-20 px-2 py-2 border-r border-slate-200 dark:border-slate-600 text-center">History</th>
                    </tr>
                  </thead>
                  <tbody>
                    {libraryFilteredRows.length === 0 ? (
                      <tr>
                        <td colSpan={15 + extraCols.length} className="px-4 py-8 text-center text-slate-500 dark:text-slate-400 text-sm">
                          No test cases yet — or no match for filter. Create on Test Cases page or clear filters.
                        </td>
                      </tr>
                    ) : (
                      libraryFilteredRows.map((tc, idx) => {
                        const key = tc._key || `row-${idx}`;
                        const isSelected = selectedSet.has(key);
                        const isRowSelectionDisabled = isTcSelectionDisabled(tc);
                        const isRowEditingLocked = isTcEditingLocked(tc);
                        const isTcInProcess = isTcSystemLocked(tc);
                        const tcRowBusy =
                          tc._source === 'current' && tc.id && testCasePendingById?.[String(tc.id)];
                        const historyCount = getTestCaseHistory(tc).length;
                        const dimProcessRow = isTcInProcess && !isRowSelectionDisabled;
                        return (
                          <tr
                            key={key}
                            title={
                              dimProcessRow
                                ? 'Running / Pending — แถวสีเทาเพื่อให้เห็นว่ามี process อยู่ (ยังเลือกได้)'
                                : isRowEditingLocked
                                  ? 'Test case is locked (running/pending or Vis=close)'
                                  : 'Double click to edit in this page'
                            }
                            className={`border-b border-slate-100 dark:border-slate-700 select-none ${isRowSelectionDisabled ? 'opacity-75 bg-slate-50 dark:bg-slate-800/50 cursor-not-allowed' : 'cursor-pointer'} ${tcRowBusy ? 'ring-1 ring-amber-400/50 dark:ring-amber-500/40' : ''} ${dimProcessRow ? '[&_td]:text-slate-500 dark:[&_td]:text-slate-400 [&_a]:text-slate-500 dark:[&_a]:text-slate-400 [&_button]:text-slate-500 dark:[&_button]:text-slate-400' : ''} ${isSelected ? 'bg-blue-50 dark:bg-blue-900/20' : dimProcessRow ? 'bg-slate-50/90 dark:bg-slate-900/50' : !isRowSelectionDisabled ? 'hover:bg-slate-50 dark:hover:bg-slate-800/50' : ''}`}
                            onClick={(e) => {
                              if (
                                e.target.closest('input[type="checkbox"]') ||
                                e.target.closest('input[type="text"]') ||
                                e.target.closest('button')
                              ) {
                                return;
                              }
                              if (isRowSelectionDisabled || tcRowBusy) return;
                              toggleSelect(key, idx, e);
                            }}
                            onDoubleClick={(e) => {
                              if (
                                e.target.closest('input[type="checkbox"]') ||
                                e.target.closest('input[type="text"]') ||
                                e.target.closest('button')
                              ) {
                                return;
                              }
                              if (isRowEditingLocked) {
                                addToast({ type: 'warning', message: 'Test case is running/pending — cannot edit until process is finished' });
                                return;
                              }
                              openRawTcEditor(tc);
                            }}
                            onMouseDown={(e) => {
                              if (
                                e.target.closest('input[type="checkbox"]') ||
                                e.target.closest('input[type="text"]') ||
                                e.target.closest('button')
                              ) {
                                return;
                              }
                              if (isRowSelectionDisabled || tcRowBusy) return;
                              if (e.button === 0) handleRowMouseDown(key, idx);
                            }}
                            onMouseEnter={() => { if (!isRowSelectionDisabled && !tcRowBusy) handleRowMouseEnter(key, idx); }}
                          >
                            <td
                              className={`px-2 py-2 border-r border-slate-100 dark:border-slate-700 sticky left-0 z-[1] ${
                                isSelected ? 'bg-blue-50 dark:bg-blue-900/20' : dimProcessRow ? 'bg-slate-50/95 dark:bg-slate-900/95' : 'bg-white dark:bg-slate-900'
                              } text-inherit`}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                disabled={isRowSelectionDisabled || tcRowBusy}
                                onChange={() => { if (!isRowSelectionDisabled && !tcRowBusy) toggleSelect(key, idx, { shiftKey: false, ctrlKey: false, metaKey: false }); }}
                                className={`w-4 h-4 rounded ${isRowSelectionDisabled || tcRowBusy ? 'cursor-not-allowed opacity-50' : 'cursor-pointer opacity-100'}`}
                                title={tcRowBusy ? 'กำลังลบ/สำเนา/จัดเรียง — รอสักครู่' : isRowSelectionDisabled ? 'ไม่สามารถเลือก — Vis=close' : undefined}
                              />
                            </td>
                            <td className="px-2 py-2 border-r border-slate-100 dark:border-slate-700 text-slate-500">
                              {idx + 1}
                            </td>
                            <td className="px-2 py-2 border-r border-slate-100 dark:border-slate-700 font-medium text-slate-800 dark:text-slate-200 min-w-[120px]">
                              {tc.name || '—'}
                            </td>
                            <td className="px-2 py-2 border-r border-slate-100 dark:border-slate-700 text-xs text-slate-500 dark:text-slate-400 truncate max-w-[80px]" title={tc._owner || '—'}>
                              {tc._owner || '—'}
                            </td>
                            <td className="px-2 py-2 border-r border-slate-100 dark:border-slate-700 text-center">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (isTcSystemLocked(tc)) {
                                    addToast({ type: 'warning', message: 'เทสต์เคสนี้ถูกล็อกจาก process (running/pending) — ไม่สามารถเปลี่ยน Vis ได้' });
                                    return;
                                  }
                                  updateTcVisibility(tc, !isTcManuallyClosed(tc));
                                  setSelectedLibraryTcKeys((prev) => prev.filter((k) => k !== key));
                                }}
                                className={`inline-flex items-center justify-center p-1 rounded ${
                                  isTcSystemLocked(tc)
                                    ? 'text-blue-500 hover:bg-blue-500/10 cursor-not-allowed'
                                    : isTcManuallyClosed(tc)
                                      ? 'text-amber-500 hover:bg-amber-500/10'
                                      : 'text-slate-400 hover:bg-slate-500/10'
                                }`}
                                title={
                                  isTcSystemLocked(tc)
                                    ? 'Locked by system (running/pending) — system lock'
                                    : isTcManuallyClosed(tc)
                                      ? 'Closed — click to open/selectable'
                                      : 'Open — click to close/lock from select all'
                                }
                              >
                                {isTcSystemLocked(tc) ? <Lock size={14} /> : isTcManuallyClosed(tc) ? <Lock size={14} /> : <Globe size={14} />}
                              </button>
                            </td>
                            <td className="px-2 py-2 border-r border-slate-100 dark:border-slate-700 min-w-[160px]">
                              {(() => {
                                const rawTag = (tc.extraColumns && (tc.extraColumns.tag || tc.extraColumns.Tag)) || '';
                                const tags = splitTags(rawTag);
                                const colorList = normalizeTagColorList(tc.extraColumns, tags.length);
                                const tcEntityKey = getTcEntityKey(tc);
                                const { orderedTags, orderedColorList, orderedOriginalIndices } =
                                  reorderTagsForDisplayWithIndices(activeProfileId, tcEntityKey, tags, colorList);
                                const firstPillColorKey = orderedColorList[0] || tc.extraColumns?.tagColor || 'mint';
                                const firstPillClass = TAG_PALETTE_MAP[firstPillColorKey] || TAG_PALETTE_MAP.mint;
                                const displayFirstOrigIndex = orderedOriginalIndices?.[0] ?? 0;
                                const cycleColor = (e) => {
                                  e.stopPropagation();
                                  const keys = TAG_PALETTE_KEYS;
                                  const cur = tags.length ? colorList[displayFirstOrigIndex] : (tc.extraColumns?.tagColor || 'mint');
                                  const safeCur = TAG_PALETTE_MAP[cur] ? cur : 'mint';
                                  const idx = Math.max(0, keys.indexOf(safeCur));
                                  const nextKey = keys[(idx + 1) % keys.length];
                                  if (tags.length) {
                                    const nextList = [...colorList];
                                    nextList[displayFirstOrigIndex] = nextKey;
                                    patchLibraryTcExtraColumns(tc, { tagColor: nextKey, tagColorList: nextList });
                                  } else {
                                    patchLibraryTcExtraColumns(tc, { tagColor: nextKey });
                                  }
                                };
                                const openTagModal = () => {
                                  setLibraryRawTcTagOverflowKey(key);
                                  setLibraryRawTcTagModalAddDraft('');
                                  setLibraryRawTcTagModalEditIndex(null);
                                  setLibraryRawTcTagModalEditDraft('');
                                };
                                const tagLocked =
                                  isRowEditingLocked ||
                                  (tc._ownerId != null && tc._ownerId !== activeProfileId);
                                /** … = จัดการ tag ทั้งหมด — pill คลิกสลับสีอย่างเดียว */
                                const showEllipsis = tagLocked ? tags.length > 1 : tags.length >= 1;

                                if (tags.length === 0) {
                                  const lockedTagHint =
                                    tc._ownerId != null && tc._ownerId !== activeProfileId
                                      ? 'แก้ไข tag ได้เฉพาะเทสต์เคสของคุณ'
                                      : isTcSystemLocked(tc)
                                        ? 'ไม่สามารถเพิ่ม tag ขณะ Running/Pending'
                                        : isTcManuallyClosed(tc)
                                          ? 'ไม่สามารถเพิ่ม tag ขณะปิด Vis (Closed)'
                                          : 'ไม่สามารถเพิ่ม tag';
                                  return (
                                    <div className="flex flex-wrap items-center gap-1 min-w-0">
                                      {tagLocked ? (
                                        <span className="inline-flex items-center gap-1.5">
                                          <span className="inline-flex items-center px-2 py-0.5 rounded-full border border-dashed border-slate-400/50 text-[11px] text-slate-400">
                                            No tag
                                          </span>
                                          <button
                                            type="button"
                                            disabled
                                            className="inline-flex items-center justify-center w-7 h-7 rounded-full border border-slate-500/30 text-slate-500 opacity-50 cursor-not-allowed shrink-0"
                                            title={lockedTagHint}
                                          >
                                            <Plus size={14} strokeWidth={2.5} />
                                          </button>
                                        </span>
                                      ) : (
                                        <>
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setLibraryRawTcTagPlusKey(key);
                                              setLibraryRawTcTagPlusDraft('');
                                              setLibraryRawTcTagHistoryOpenKey(key);
                                            }}
                                            className="inline-flex items-center px-2 py-0.5 rounded-full border border-dashed border-slate-400/60 text-[11px] text-slate-300 hover:border-slate-300 hover:text-slate-200 transition-colors"
                                            title="Add tag (or use +)"
                                          >
                                            No tag
                                          </button>
                                          {libraryRawTcTagPlusKey === key ? (
                                            <>
                                              <input
                                                type="text"
                                                value={libraryRawTcTagPlusDraft}
                                                onChange={(e) => setLibraryRawTcTagPlusDraft(e.target.value)}
                                                onKeyDown={(e) => {
                                                  if (e.key === 'Enter') {
                                                    if (tagEnterShouldIgnoreIme(e)) return;
                                                    e.preventDefault();
                                                    const add = libraryRawTcTagPlusDraft.trim();
                                                    if (!add) {
                                                      setLibraryRawTcTagPlusKey(null);
                                                      setLibraryRawTcTagPlusDraft('');
                                                      setLibraryRawTcTagHistoryOpenKey(null);
                                                      return;
                                                    }
                                                    const next = upsertTagsString(rawTag, add);
                                                    patchLibraryTcExtraColumns(tc, { tag: next });
                                                    setLibraryRawTcTagPlusDraft('');
                                                    setLibraryRawTcTagPlusKey(null);
                                                    setLibraryRawTcTagHistoryOpenKey(null);
                                                  }
                                                  if (e.key === 'Escape') {
                                                    e.preventDefault();
                                                    setLibraryRawTcTagPlusKey(null);
                                                    setLibraryRawTcTagPlusDraft('');
                                                    setLibraryRawTcTagHistoryOpenKey(null);
                                                  }
                                                }}
                                                onBlur={() => {
                                                  setLibraryRawTcTagPlusKey(null);
                                                  setLibraryRawTcTagPlusDraft('');
                                                  setLibraryRawTcTagHistoryOpenKey(null);
                                                }}
                                                onClick={(e) => e.stopPropagation()}
                                                className="px-2 py-0.5 text-[11px] rounded-full border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 w-28 min-w-0"
                                                placeholder="tag…"
                                                title="Enter — add (comma ok)"
                                                autoFocus
                                              />
                                              {libraryRawTcTagHistoryOpenKey === key && (
                                                <div className="mt-1 flex flex-wrap gap-1">
                                                  {(() => {
                                                    const existingLower = new Set(
                                                      tags.map((t) => t.toLowerCase())
                                                    );
                                                    const q = libraryRawTcTagPlusDraft
                                                      .trim()
                                                      .toLowerCase();
                                                    const acc = [];
                                                    (savedTestCases || []).forEach((t) => {
                                                      const rawExtra =
                                                        t?.extraColumns &&
                                                        (t.extraColumns.tag || t.extraColumns.Tag);
                                                      if (!rawExtra) return;
                                                      splitTags(rawExtra).forEach((tg) =>
                                                        acc.push(tg)
                                                      );
                                                    });
                                                    const seen = new Set();
                                                    return acc
                                                      .filter((tg) => {
                                                        const v = String(tg || '').trim();
                                                        if (!v) return false;
                                                        const lt = v.toLowerCase();
                                                        if (existingLower.has(lt)) return false;
                                                        if (q && !lt.includes(q)) return false;
                                                        if (seen.has(lt)) return false;
                                                        seen.add(lt);
                                                        return true;
                                                      })
                                                      .slice(0, 10)
                                                      .map((tg) => (
                                                        <button
                                                          key={`${key}-${tg}`}
                                                          type="button"
                                                          onMouseDown={(e) => {
                                                            e.preventDefault();
                                                            const next = upsertTagsString(
                                                              rawTag,
                                                              tg
                                                            );
                                                            patchLibraryTcExtraColumns(tc, {
                                                              tag: next,
                                                            });
                                                            setLibraryRawTcTagPlusDraft('');
                                                            setLibraryRawTcTagPlusKey(null);
                                                            setLibraryRawTcTagHistoryOpenKey(null);
                                                          }}
                                                          className="px-2 py-0.5 rounded-full text-[11px] font-medium border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
                                                          title={`Use tag "${tg}"`}
                                                        >
                                                          {tg}
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
                                                setLibraryRawTcTagPlusKey(key);
                                                setLibraryRawTcTagPlusDraft('');
                                                setLibraryRawTcTagHistoryOpenKey(key);
                                              }}
                                              className="inline-flex items-center justify-center w-7 h-7 rounded-full text-[11px] font-semibold border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 shrink-0"
                                              title="Add tag"
                                            >
                                              <Plus size={14} strokeWidth={2.5} />
                                            </button>
                                          )}
                                        </>
                                      )}
                                    </div>
                                  );
                                }

                                return (
                                  <div className="flex flex-wrap items-center gap-1 min-w-0">
                                    {!tagLocked ? (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          cycleColor(e);
                                        }}
                                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium max-w-[130px] ${firstPillClass} hover:brightness-95 transition-colors`}
                                        title="คลิกเพื่อเปลี่ยนสี tag — ใช้ … เพื่อแก้ไขรายการ tag"
                                      >
                                        <span className="w-2 h-2 rounded-full shrink-0 bg-current/70" />
                                        <span className="truncate">{orderedTags[0]}</span>
                                      </button>
                                    ) : (
                                      <span
                                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium max-w-[120px] ${firstPillClass}`}
                                        title={orderedTags[0]}
                                      >
                                        <span className="w-2 h-2 rounded-full shrink-0 bg-current/70" />
                                        <span className="truncate">{orderedTags[0]}</span>
                                      </span>
                                    )}
                                    {!tagLocked &&
                                      (libraryRawTcTagPlusKey === key ? (
                                        <input
                                          type="text"
                                          value={libraryRawTcTagPlusDraft}
                                          onChange={(e) => setLibraryRawTcTagPlusDraft(e.target.value)}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                              if (tagEnterShouldIgnoreIme(e)) return;
                                              e.preventDefault();
                                              const add = libraryRawTcTagPlusDraft.trim();
                                              if (!add) {
                                                setLibraryRawTcTagPlusKey(null);
                                                setLibraryRawTcTagPlusDraft('');
                                                return;
                                              }
                                              const next = upsertTagsString(rawTag, add);
                                              patchLibraryTcExtraColumns(tc, { tag: next });
                                              setLibraryRawTcTagPlusDraft('');
                                              setLibraryRawTcTagPlusKey(null);
                                            }
                                            if (e.key === 'Escape') {
                                              e.preventDefault();
                                              setLibraryRawTcTagPlusKey(null);
                                              setLibraryRawTcTagPlusDraft('');
                                            }
                                          }}
                                          onBlur={() => {
                                            setLibraryRawTcTagPlusKey(null);
                                            setLibraryRawTcTagPlusDraft('');
                                          }}
                                          onClick={(e) => e.stopPropagation()}
                                          className="px-2 py-0.5 text-[11px] rounded-full border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 w-28 min-w-0"
                                          placeholder="tag…"
                                          title="Enter — add (comma ok)"
                                          autoFocus
                                        />
                                      ) : (
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setLibraryRawTcTagPlusKey(key);
                                            setLibraryRawTcTagPlusDraft('');
                                          }}
                                          className="inline-flex items-center justify-center w-7 h-7 rounded-full text-[11px] font-semibold border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 shrink-0"
                                          title="Add tag"
                                        >
                                          <Plus size={14} strokeWidth={2.5} />
                                        </button>
                                      )
                                    )}
                                    {showEllipsis && (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          openTagModal();
                                        }}
                                        className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold border border-slate-200 dark:border-slate-700 bg-white/60 dark:bg-slate-800 text-slate-600 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 shrink-0"
                                        title="Show all tags"
                                      >
                                        …
                                      </button>
                                    )}
                                  </div>
                                );
                              })()}
                            </td>
                            <td className="px-2 py-2 border-r border-slate-100 dark:border-slate-700 text-center text-slate-500 dark:text-slate-400 text-xs">
                              {(tc.updatedAt || tc.createdAt) ? new Date(tc.updatedAt || tc.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—'}
                            </td>
                            <td className="px-2 py-2 border-r border-slate-100 dark:border-slate-700 text-slate-600 dark:text-slate-300">
                              {tc.binName ? (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    focusFileInLibrary(tc.binName);
                                  }}
                                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline hover:text-blue-700 dark:hover:text-blue-300"
                                  title="View this file in File in Library"
                                >
                                  {tc.binName}
                                </button>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td className="px-2 py-2 border-r border-slate-100 dark:border-slate-700 text-slate-600 dark:text-slate-300">
                              {tc.linName ? (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    focusFileInLibrary(tc.linName);
                                  }}
                                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline hover:text-blue-700 dark:hover:text-blue-300"
                                  title="View this file in File in Library"
                                >
                                  {tc.linName}
                                </button>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td className="px-2 py-2 border-r border-slate-100 dark:border-slate-700 text-slate-600 dark:text-slate-300">
                              {tc.vcdName ? (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    focusFileInLibrary(tc.vcdName);
                                  }}
                                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline hover:text-blue-700 dark:hover:text-blue-300"
                                  title="View this file in File in Library"
                                >
                                  {tc.vcdName}
                                </button>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td
                              className="px-2 py-2 border-r border-slate-100 dark:border-slate-700 text-slate-600 dark:text-slate-300 truncate max-w-[180px]"
                              title={Array.isArray(tc.mdiNames) && tc.mdiNames.length > 0 ? tc.mdiNames.join(', ') : undefined}
                            >
                              {Array.isArray(tc.mdiNames) && tc.mdiNames.length > 0 ? (
                                tc.mdiNames.map((name, idx) => (
                                  <span key={name}>
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        focusFileInLibrary(String(name));
                                      }}
                                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline hover:text-blue-700 dark:hover:text-blue-300"
                                      title="View this file in File in Library"
                                    >
                                      {name}
                                    </button>
                                    {idx < tc.mdiNames.length - 1 ? ', ' : ''}
                                  </span>
                                ))
                              ) : (
                                '—'
                              )}
                            </td>
                            {extraCols.map((col) => (
                              <td
                                key={col}
                                className="px-2 py-2 border-r border-slate-100 dark:border-slate-700 text-slate-600 dark:text-slate-300 min-w-[90px] truncate max-w-[140px]"
                                title={getExtraVal(tc, col) || undefined}
                              >
                                {(() => {
                                  const val = getExtraVal(tc, col);
                                  if (!val) return '—';
                                  const isFileCol =
                                    /^VCD\d+$/i.test(col) ||
                                    /^ERoM\d+$/i.test(col) ||
                                    /^ULP\d+$/i.test(col) ||
                                    /^MDI\d+$/i.test(col);
                                  if (!isFileCol) return val;
                                  return (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        focusFileInLibrary(String(val));
                                      }}
                                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline hover:text-blue-700 dark:hover:text-blue-300"
                                      title="View this file in File in Library"
                                    >
                                      {val}
                                    </button>
                                  );
                                })()}
                              </td>
                            ))}
                            <td className="px-2 py-2 border-r border-slate-100 dark:border-slate-700 text-center text-slate-600 dark:text-slate-400">
                              {typeof tc.tryCount === 'number' && tc.tryCount > 0 ? tc.tryCount : 1}
                            </td>
                            <td className="px-2 py-2 border-r border-slate-100 dark:border-slate-700 text-center">
                              {(() => {
                                const status = tc._status || null;
                                if (status === 'running') {
                                  return (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 border border-blue-200 text-[10px] font-semibold" title="Running in current set(s)">
                                      Running
                                    </span>
                                  );
                                }
                                if (status === 'pending') {
                                  return (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-yellow-100 text-yellow-700 border border-yellow-200 text-[10px] font-semibold" title="Pending in run queue">
                                      Pending
                                    </span>
                                  );
                                }
                                if (status === 'completed') {
                                  return (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200 text-[10px] font-semibold" title="Completed in past run(s)">
                                      Completed
                                    </span>
                                  );
                                }
                                if (tc._source === 'set' && tc._setId) {
                                  const setName = (savedTestCaseSets || []).find((s) => s.id === tc._setId)?.name || 'Set';
                                  return (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600 text-[10px] font-medium" title={`In set: ${setName}`}>
                                      In set
                                    </span>
                                  );
                                }
                                return <span className="text-slate-400 dark:text-slate-500 text-[10px]">—</span>;
                              })()}
                            </td>
                            <td className="px-2 py-2 border-r border-slate-100 dark:border-slate-700 text-center">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (isTcSystemLocked(tc)) {
                                    openRawTcDuplicateEditor(tc);
                                    return;
                                  }
                                  openRawTcEditor(tc);
                                }}
                                disabled={!canEditRawTcRow(tc) && !isTcSystemLocked(tc)}
                                className={`inline-flex items-center justify-center p-1.5 rounded-lg transition-colors ${
                                  canEditRawTcRow(tc)
                                    ? rawTcEditorKey === key
                                      ? 'bg-blue-600 text-white'
                                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                                    : isTcSystemLocked(tc)
                                      ? 'text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30'
                                      : 'text-slate-300 dark:text-slate-600 cursor-not-allowed'
                                }`}
                                title={
                                  canEditRawTcRow(tc)
                                    ? 'แก้ไขในหน้านี้'
                                    : isTcSystemLocked(tc)
                                      ? 'Running/Pending — Duplicate เพื่อแก้ไขได้'
                                      : 'แก้ไม่ได้ (ล็อกหรือไม่ใช่โปรไฟล์คุณ)'
                                }
                              >
                                {isTcSystemLocked(tc) ? <Copy size={16} /> : <Pencil size={16} />}
                              </button>
                            </td>
                            <td className="px-2 py-2 border-r border-slate-100 dark:border-slate-700 text-center">
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setTestCaseHistoryFor({ tc }); }}
                                className="inline-flex items-center justify-center gap-1 px-1.5 py-1 rounded text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                                title="View job/set history for this test case"
                              >
                                <History size={14} />
                                {historyCount > 0 && <span className="text-[10px] font-medium">{historyCount}</span>}
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
                </div>
                {rawTcEditorDraft && (
                  <div className="w-full xl:w-[min(400px,calc(100vw-2rem))] flex-shrink-0 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/50 p-4 space-y-3 shadow-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-bold text-slate-800 dark:text-slate-100">
                        {rawTcEditorMode === 'duplicate' ? 'Duplicate Test Case' : 'Edit Test Case'}
                      </span>
                      <button
                        type="button"
                        onClick={closeRawTcEditor}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700"
                        title="ปิด"
                      >
                        <X size={18} />
                      </button>
                    </div>
                    <datalist id="raw-tc-vcd-datalist">
                      {fileOptionsByKind.vcd.map((n) => (
                        <option key={n} value={n} />
                      ))}
                    </datalist>
                    <datalist id="raw-tc-bin-datalist">
                      {fileOptionsByKind.bin.map((n) => (
                        <option key={n} value={n} />
                      ))}
                    </datalist>
                    <datalist id="raw-tc-lin-datalist">
                      {fileOptionsByKind.lin.map((n) => (
                        <option key={n} value={n} />
                      ))}
                    </datalist>
                    <datalist id="raw-tc-mdi-datalist">
                      {fileOptionsByKind.mdi.map((n) => (
                        <option key={n} value={n} />
                      ))}
                    </datalist>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
                      Name
                      <input
                        type="text"
                        value={rawTcEditorDraft.name}
                        onChange={(e) => setRawTcEditorDraft((d) => (d ? { ...d, name: e.target.value } : d))}
                        className="mt-1 w-full px-2 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900"
                      />
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-600 dark:text-slate-300">Tag</div>
                        <div ref={rawTcEditorTagToolsRef} className="relative mt-1 flex items-center gap-1.5 min-w-0">
                          <input
                            type="text"
                            value={rawTcEditorDraft.tag}
                            onChange={(e) => {
                              const nextTag = e.target.value;
                              setRawTcEditorDraft((d) => {
                                if (!d) return d;
                                const next = { ...d, tag: nextTag };
                                const parts = splitTags(nextTag);
                                const fb = TAG_PALETTE_MAP[d.tagColor] ? d.tagColor : 'mint';
                                if (parts.length === 0) {
                                  next.tagColorList = [];
                                } else {
                                  const prev = Array.isArray(d.tagColorList) ? d.tagColorList : [];
                                  next.tagColorList = parts.map((_, i) => {
                                    const k = prev[i];
                                    return TAG_PALETTE_MAP[k] ? k : fb;
                                  });
                                }
                                return next;
                              });
                            }}
                            className="flex-1 min-w-0 px-2 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900"
                          />
                          <div className="relative shrink-0">
                            <button
                              type="button"
                              onClick={() => setRawTcEditorTagToolsOpen((o) => !o)}
                              className="inline-flex items-center justify-center w-7 h-7 rounded-full text-[12px] font-semibold border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
                              title="สี tag — เหมือนคอลัมน์ TC"
                            >
                              …
                            </button>
                            {rawTcEditorTagToolsOpen && (
                              <div className="absolute right-0 top-full z-[130] mt-1 flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 p-2 shadow-xl">
                                {(() => {
                                  const hdrTags = splitTags(rawTcEditorDraft.tag || '');
                                  const displayKey = hdrTags.length
                                    ? normalizeTagColorList(
                                        {
                                          tagColor: rawTcEditorDraft.tagColor,
                                          tagColorList: rawTcEditorDraft.tagColorList,
                                        },
                                        hdrTags.length
                                      )[0]
                                    : TAG_PALETTE_MAP[rawTcEditorDraft.tagColor]
                                      ? rawTcEditorDraft.tagColor
                                      : 'mint';
                                  const safeDisplayKey = TAG_PALETTE_MAP[displayKey] ? displayKey : 'mint';
                                  return (
                                    <TagColorSwatchPicker
                                      size="sm"
                                      value={safeDisplayKey}
                                      menuZClass="z-[140]"
                                      onChange={(k) => {
                                        setRawTcEditorDraft((d) => {
                                          if (!d) return d;
                                          const tagArr = splitTags(d.tag);
                                          const next = { ...d, tagColor: k };
                                          if (tagArr.length) next.tagColorList = tagArr.map(() => k);
                                          else next.tagColorList = [];
                                          return next;
                                        });
                                      }}
                                    />
                                  );
                                })()}
                              </div>
                            )}
                          </div>
                          <span
                            className="shrink-0 w-px h-5 self-center bg-slate-200 dark:bg-slate-600"
                            aria-hidden
                          />
                        </div>
                      </div>
                      <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
                        Try
                        <input
                          type="number"
                          min={1}
                          max={100}
                          value={rawTcEditorDraft.tryCount}
                          onChange={(e) => setRawTcEditorDraft((d) => (d ? { ...d, tryCount: e.target.value } : d))}
                          className="mt-1 w-full px-2 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900"
                        />
                      </label>
                    </div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
                      ERoM
                      <div className="relative mt-1">
                        <input
                          type="text"
                          value={rawTcEditorDraft.binName}
                          onChange={(e) => setRawTcEditorDraft((d) => (d ? { ...d, binName: e.target.value } : d))}
                          className="w-full pr-10 px-2 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900"
                          placeholder="Type to search…"
                        />
                        <button
                          type="button"
                          onClick={() => setRawTcFilePicker({ kind: 'bin', q: rawTcEditorDraft.binName || '' })}
                          className="absolute inset-y-0 right-0 px-2 inline-flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                          title="Browse from Library"
                        >
                          <ChevronDown size={16} />
                        </button>
                      </div>
                    </label>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
                      ULP
                      <div className="relative mt-1">
                        <input
                          type="text"
                          value={rawTcEditorDraft.linName}
                          onChange={(e) => setRawTcEditorDraft((d) => (d ? { ...d, linName: e.target.value } : d))}
                          className="w-full pr-10 px-2 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900"
                          placeholder="Type to search…"
                        />
                        <button
                          type="button"
                          onClick={() => setRawTcFilePicker({ kind: 'lin', q: rawTcEditorDraft.linName || '' })}
                          className="absolute inset-y-0 right-0 px-2 inline-flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                          title="Browse from Library"
                        >
                          <ChevronDown size={16} />
                        </button>
                      </div>
                    </label>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
                      VCD
                      <div className="relative mt-1">
                        <input
                          type="text"
                          value={rawTcEditorDraft.vcdName}
                          onChange={(e) => setRawTcEditorDraft((d) => (d ? { ...d, vcdName: e.target.value } : d))}
                          className="w-full pr-10 px-2 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900"
                          placeholder="Type to search…"
                        />
                        <button
                          type="button"
                          onClick={() => setRawTcFilePicker({ kind: 'vcd', q: rawTcEditorDraft.vcdName || '' })}
                          className="absolute inset-y-0 right-0 px-2 inline-flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                          title="Browse from Library"
                        >
                          <ChevronDown size={16} />
                        </button>
                      </div>
                    </label>
                    {rawTcFilePicker && (
                      <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
                        <div className="absolute inset-0 bg-black/50" onClick={() => setRawTcFilePicker(null)} role="presentation" />
                        <div className="relative w-[min(980px,calc(100vw-2rem))] max-h-[80vh] overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl flex flex-col">
                          <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2">
                            <div className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">
                              Browse file — {rawTcFilePicker.kind === 'bin' ? 'ERoM' : rawTcFilePicker.kind === 'vcd' ? 'VCD' : 'ULP'}
                            </div>
                            <input
                              type="text"
                              value={rawTcFilePicker.q}
                              onChange={(e) => setRawTcFilePicker((p) => (p ? { ...p, q: e.target.value } : p))}
                              placeholder="Type to search…"
                              className="ml-3 flex-1 min-w-0 px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800"
                            />
                            <button
                              type="button"
                              onClick={() => setRawTcFilePicker(null)}
                              className="ml-auto p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                              title="Close"
                            >
                              <X size={18} />
                            </button>
                          </div>
                          <div className="overflow-auto flex-1">
                            <table className="w-full text-left text-xs border-collapse select-none">
                              <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-slate-900/95 border-b border-slate-200 dark:border-slate-600">
                                <tr className="text-slate-600 dark:text-slate-300">
                                  <th className="px-2 py-2 font-semibold min-w-[220px]">Name</th>
                                  <th className="px-2 py-2 font-semibold min-w-[140px]">Tags</th>
                                  <th className="px-2 py-2 font-semibold min-w-[120px]">Used by TC</th>
                                  <th className="px-2 py-2 font-semibold min-w-[120px]">Sets</th>
                                  <th className="px-2 py-2 font-semibold w-16">Owner</th>
                                  <th className="px-2 py-2 font-semibold w-10 text-center" title="Visibility">Vis</th>
                                  <th className="px-2 py-2 font-semibold min-w-[120px]">Modified</th>
                                  <th className="px-2 py-2 font-semibold w-20 text-right">Size</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                                {rawTcPickerFiles.length === 0 ? (
                                  <tr>
                                    <td colSpan={8} className="p-8 text-center text-slate-400">No files</td>
                                  </tr>
                                ) : (
                                  rawTcPickerFiles.map((f) => {
                                    const tagVal = (fileTags && fileTags[f.id]) || '';
                                    const tags = splitTags(tagVal);
                                    const displayName = (fileDisplayNames && fileDisplayNames[f.id]) || (String(f.name || '').split('/').pop() || f.name);
                                    let usedByTcs = getTestCasesUsingFile(f.name, fileReferenceTestCases, fileReferenceTestCaseSets);
                                    let setNames = getSetNamesUsingFile(f.name, fileReferenceTestCaseSets);
                                    if ((usedByTcs?.length || 0) === 0 || (setNames?.length || 0) === 0) {
                                      const fromJobs = getJobRefsUsingFile(f.name, jobs);
                                      if ((usedByTcs?.length || 0) === 0) usedByTcs = fromJobs.usedByTcs;
                                      if ((setNames?.length || 0) === 0) setNames = fromJobs.setNames;
                                    }
                                    const lastModified = f.updatedAt || f.uploadDate || f.createdAt || null;
                                    const ownerShort = resolveFileOwnerDisplay(f, ownerLabelCtx);
                                    const inUseByBatch = fileNamesInUseByBatch.has(f.name);
                                    const isClosed = isFileManuallyClosed(f);
                                    return (
                                      <tr
                                        key={`rawtc-pick-${rawTcFilePicker.kind}-${f.id}`}
                                        className={`text-slate-800 dark:text-slate-100 ${isClosed ? 'opacity-70 bg-slate-50 dark:bg-slate-800/50 cursor-not-allowed' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer'}`}
                                        onClick={() => { if (!isClosed) pickRawTcFileName(f); }}
                                        title={isClosed ? 'Vis=close — not selectable' : 'Click to choose'}
                                      >
                                        <td className="px-2 py-2">
                                          <div className="font-medium break-all" title={f.name}>{displayName}</div>
                                          {displayName !== f.name && <div className="text-[10px] text-slate-400 truncate" title={f.name}>{String(f.name || '').split('/').pop() || f.name}</div>}
                                        </td>
                                        <td className="px-2 py-2">
                                          {tags.length === 0 ? (
                                            <span className="text-slate-400">—</span>
                                          ) : (
                                            <div className="flex flex-wrap items-center gap-0.5">
                                              {tags.slice(0, 3).map((t, ti) => (
                                                <button
                                                  key={`rawtc-pick-tag-${f.id}-${ti}-${t}`}
                                                  className="px-1 py-0.5 rounded-full text-[10px] bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700"
                                                  title={t}
                                                  type="button"
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    setRawTcFilePicker(null);
                                                    setShowAllUsedByTcForFileName(null);
                                                    setShowAllSetsForFileName(null);
                                                    setFileTagsModalEditIndex(null);
                                                    setFileTagsModalEditDraft('');
                                                    setFileTagsModalAddDraft('');
                                                    setFileTagsModalAddOpen(false);
                                                    setShowAllTagsForFileId(f.id);
                                                  }}
                                                >
                                                  {t}
                                                </button>
                                              ))}
                                              {tags.length > 3 && (
                                                <button
                                                  className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold border border-slate-200 dark:border-slate-700 bg-white/60 dark:bg-slate-800 text-slate-600 dark:text-slate-200"
                                                  title={tags.join(', ')}
                                                  type="button"
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    setRawTcFilePicker(null);
                                                    setShowAllUsedByTcForFileName(null);
                                                    setShowAllSetsForFileName(null);
                                                    setFileTagsModalEditIndex(null);
                                                    setFileTagsModalEditDraft('');
                                                    setFileTagsModalAddDraft('');
                                                    setFileTagsModalAddOpen(false);
                                                    setShowAllTagsForFileId(f.id);
                                                  }}
                                                >
                                                  …
                                                </button>
                                              )}
                                            </div>
                                          )}
                                        </td>
                                        <td className="px-2 py-2">
                                          {usedByTcs.length === 0 ? (
                                            <span className="text-slate-400">—</span>
                                          ) : (
                                            <div className="flex flex-wrap items-center gap-0.5">
                                              {usedByTcs.slice(0, 3).map((u, ui) => (
                                                <button
                                                  key={`rawtc-pick-ub-${f.id}-${ui}-${u.name}-${u.set || ''}`}
                                                  className="px-1 py-0.5 rounded-full text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700"
                                                  title={u.set ? `${u.name} (${u.set})` : u.name}
                                                  type="button"
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    setRawTcFilePicker(null);
                                                    setShowAllTagsForFileId(null);
                                                    setShowAllSetsForFileName(null);
                                                    setShowAllUsedByTcForFileName(f.name);
                                                  }}
                                                >
                                                  {u.name}
                                                </button>
                                              ))}
                                              {usedByTcs.length > 3 && (
                                                <button
                                                  className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold border border-slate-200 dark:border-slate-700 bg-white/60 dark:bg-slate-800 text-slate-600 dark:text-slate-200"
                                                  title={usedByTcs.map((u) => (u.set ? `${u.name} (${u.set})` : u.name)).join('\n')}
                                                  type="button"
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    setRawTcFilePicker(null);
                                                    setShowAllTagsForFileId(null);
                                                    setShowAllSetsForFileName(null);
                                                    setShowAllUsedByTcForFileName(f.name);
                                                  }}
                                                >
                                                  …
                                                </button>
                                              )}
                                            </div>
                                          )}
                                        </td>
                                        <td className="px-2 py-2">
                                          {setNames.length === 0 ? (
                                            <span className="text-slate-400">—</span>
                                          ) : (
                                            <div className="flex flex-wrap items-center gap-0.5">
                                              {setNames.slice(0, 3).map((sn) => {
                                                const st = setStatusByName.get(sn) ?? null;
                                                return (
                                                  <button
                                                    key={`rawtc-pick-set-${f.id}-${sn}`}
                                                    className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium border max-w-[180px] truncate ${getSetJobStatusPillClass(st)}`}
                                                    title={st ? `${sn} — job: ${st}` : `${sn} — no active job`}
                                                    type="button"
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      setRawTcFilePicker(null);
                                                      setShowAllTagsForFileId(null);
                                                      setShowAllUsedByTcForFileName(null);
                                                      setShowAllSetsForFileName(f.name);
                                                    }}
                                                  >
                                                    {sn}
                                                  </button>
                                                );
                                              })}
                                              {setNames.length > 3 && (
                                                <button
                                                  className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold border border-slate-200 dark:border-slate-700 bg-white/60 dark:bg-slate-800 text-slate-600 dark:text-slate-200"
                                                  title={setNames.join(', ')}
                                                  type="button"
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    setRawTcFilePicker(null);
                                                    setShowAllTagsForFileId(null);
                                                    setShowAllUsedByTcForFileName(null);
                                                    setShowAllSetsForFileName(f.name);
                                                  }}
                                                >
                                                  …
                                                </button>
                                              )}
                                            </div>
                                          )}
                                        </td>
                                        <td className="px-2 py-2 text-slate-600 dark:text-slate-300">{ownerShort}</td>
                                        <td className="px-2 py-2 text-center text-slate-400">
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              if (inUseByBatch) {
                                                addToast({ type: 'warning', message: 'File is locked by a running or pending set — cannot change Vis' });
                                                return;
                                              }
                                              const nextClosed = !isClosed;
                                              setFileVisById((prev) => ({ ...prev, [f.id]: nextClosed ? 'close' : 'open' }));
                                            }}
                                            className={`inline-flex items-center justify-center p-1 rounded ${
                                              inUseByBatch ? 'text-blue-500 hover:bg-blue-500/10 cursor-not-allowed opacity-80' : isClosed ? 'text-amber-500 hover:bg-amber-500/10' : 'text-slate-400 hover:bg-slate-500/10'
                                            }`}
                                            title={inUseByBatch ? 'Locked by system (running/pending)' : isClosed ? 'Closed — click to open/selectable' : 'Open — click to close/lock from select all'}
                                          >
                                            {inUseByBatch ? <Lock size={14} className="inline" /> : isClosed ? <Lock size={14} className="inline" /> : <Globe size={14} className="inline" />}
                                          </button>
                                        </td>
                                        <td className="px-2 py-2 whitespace-nowrap text-slate-500 dark:text-slate-400 text-[11px]">{lastModified ? String(lastModified).replace('T', ' ').slice(0, 16) : '—'}</td>
                                        <td className="px-2 py-2 text-right text-slate-600 dark:text-slate-300 whitespace-nowrap">{f.sizeFormatted ?? f.size ?? '—'}</td>
                                      </tr>
                                    );
                                  })
                                )}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    )}
                    <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-600">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                          add extra file
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setRawTcEditorDraft((d) =>
                              d
                                ? {
                                    ...d,
                                    extraSlots: [
                                      ...(d.extraSlots || []),
                                      { id: newRawTcSlotId(), kind: 'vcd', file: '' },
                                    ],
                                  }
                                : d
                            )
                          }
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
                          title="add extra file"
                        >
                          <Plus size={14} />
                          add
                        </button>
                      </div>
                      {(rawTcEditorDraft.extraSlots || []).length === 0 ? (
                        <p className="text-[11px] text-slate-400 dark:text-slate-500 italic">no extra file — click + to add</p>
                      ) : (
                        <>
                          <div className="flex items-center gap-x-3 text-[10px] font-medium text-slate-500 dark:text-slate-400">
                            <div className="w-[4.25rem]">column</div>
                            <div className="w-[5.75rem]">type</div>
                            <div className="flex-1 min-w-0">select file</div>
                            <div className="w-9" />
                          </div>
                          {(rawTcEditorDraft.extraSlots || []).map((slot, slotIndex) => {
                          const slotsList = rawTcEditorDraft.extraSlots || [];
                          const ordinalAmongKind = slotsList.slice(0, slotIndex + 1).filter((s) => s.kind === slot.kind).length;
                          const columnLabel = getExtraSlotColumnLabel(slot.kind, ordinalAmongKind);
                          const listId =
                            slot.kind === 'vcd'
                              ? 'raw-tc-vcd-datalist'
                              : slot.kind === 'erom'
                                ? 'raw-tc-bin-datalist'
                                : slot.kind === 'ulp'
                                  ? 'raw-tc-lin-datalist'
                                  : 'raw-tc-mdi-datalist';
                          return (
                            <div
                              key={slot.id}
                              className={`flex items-center gap-x-3 ${slot.kind === 'mdi' ? 'rounded-lg border border-dashed border-slate-300 dark:border-slate-600 p-2' : ''}`}
                              onDragOver={
                                slot.kind === 'mdi'
                                  ? (e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                    }
                                  : undefined
                              }
                              onDrop={
                                slot.kind === 'mdi'
                                  ? (e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      const f = e.dataTransfer.files?.[0];
                                      if (!f?.name) return;
                                      setRawTcEditorDraft((d) =>
                                        d
                                          ? {
                                              ...d,
                                              extraSlots: d.extraSlots.map((s) =>
                                                s.id === slot.id ? { ...s, file: f.name.trim() } : s
                                              ),
                                            }
                                          : d
                                      );
                                    }
                                  : undefined
                              }
                            >
                              <div
                                className="box-border flex h-9 w-[4.25rem] flex-shrink-0 items-center text-xs font-bold tabular-nums text-blue-700 dark:text-blue-300"
                                title="Matches the Raw Test Cases table header for this file"
                              >
                                {columnLabel}
                              </div>
                              <select
                                value={slot.kind}
                                onChange={(e) => {
                                  const kind = e.target.value;
                                  setRawTcEditorDraft((d) =>
                                    d
                                      ? {
                                          ...d,
                                          extraSlots: d.extraSlots.map((s) =>
                                            s.id === slot.id ? { ...s, kind } : s
                                          ),
                                        }
                                      : d
                                  );
                                }}
                                className="box-border h-9 w-[5.75rem] flex-shrink-0 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                                title={`Maps to table column ${columnLabel}`}
                              >
                                <option value="vcd">VCD</option>
                                <option value="erom">ERoM</option>
                                <option value="ulp">ULP</option>
                                <option value="mdi">MDI</option>
                              </select>
                              <input
                                type="text"
                                list={listId}
                                value={slot.file}
                                onChange={(e) =>
                                  setRawTcEditorDraft((d) =>
                                    d
                                      ? {
                                          ...d,
                                          extraSlots: d.extraSlots.map((s) =>
                                            s.id === slot.id ? { ...s, file: e.target.value } : s
                                          ),
                                        }
                                      : d
                                  )
                                }
                                className="box-border h-9 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-900 placeholder:text-slate-400 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
                                placeholder={slot.kind === 'mdi' ? `${columnLabel} — select or drop` : 'select file'}
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  setRawTcEditorDraft((d) =>
                                    d
                                      ? {
                                          ...d,
                                          extraSlots: d.extraSlots.filter((s) => s.id !== slot.id),
                                        }
                                      : d
                                  )
                                }
                                className="box-border flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
                                title="delete extra file"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          );
                          })}
                        </>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={handleSaveRawTcEditor}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700"
                      >
                        <Save size={14} />
                        {rawTcEditorMode === 'duplicate' ? 'Save as new' : 'save'}
                      </button>
                      <button
                        type="button"
                        onClick={closeRawTcEditor}
                        className="px-3 py-2 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
                      >
                        cancel
                      </button>
                    </div>
                    {onNavigateToTestCases && (
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 border-t border-slate-200 dark:border-slate-600 pt-3">
                        want to create test case? —{' '}
                        <button
                          type="button"
                          onClick={() => {
                            syncFullLibraryToSavedTestCases();
                            clearLibraryEditContext();
                            setLoadedSetId(null);
                            onNavigateToTestCases();
                          }}
                          className="font-medium text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          go to Create Test Case
                        </button>
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })()
      ) : (
        /* File in Library — filter, multi-select (shift/ctrl/drag), delete icon */
        (() => {
          const selectedFileSet = new Set(selectedLibraryFileIds);
          const selectableFileIds = filteredFiles
            .filter((f) => !fileNamesInUseByBatch.has(f.name) && !isFileManuallyClosed(f))
            .map((f) => f.id)
            .filter(Boolean);
          const allFilesInUse = (uploadedFiles || []).length > 0 && (uploadedFiles || []).every((f) => fileNamesInUseByBatch.has(f.name));
          const toggleFileSelect = (fileId, index, e) => {
            const row = filteredFiles[index];
            if (row && isFileManuallyClosed(row)) return;
            // Allow selecting in-use files; lock destructive actions instead.
            if (e.shiftKey) {
              const last = lastClickedFileIndexRef.current;
              const from = last != null ? Math.min(last, index) : index;
              const to = last != null ? Math.max(last, index) : index;
              const idsToAdd = filteredFiles
                .slice(from, to + 1)
                .filter((f) => !isFileManuallyClosed(f))
                .map((f) => f.id)
                .filter(Boolean);
              setSelectedLibraryFileIds((prev) => [...new Set([...prev, ...idsToAdd])]);
              lastClickedFileIndexRef.current = index;
              return;
            }
            if (e.ctrlKey || e.metaKey) {
              setSelectedLibraryFileIds((prev) =>
                prev.includes(fileId) ? prev.filter((id) => id !== fileId) : [...prev, fileId],
              );
              lastClickedFileIndexRef.current = index;
              return;
            }
            // Click ปกติ: toggle ได้หลายไฟล์ (ไม่บังคับ single select)
            setSelectedLibraryFileIds((prev) =>
              prev.includes(fileId) ? prev.filter((id) => id !== fileId) : [...prev, fileId],
            );
            lastClickedFileIndexRef.current = index;
          };
          const selectedInUse = selectedLibraryFileIds.filter((id) => {
            const f = filteredFiles.find((x) => x.id === id);
            return f && fileNamesInUseByBatch.has(f.name);
          }).length;
          const handleDeleteSelectedFiles = async () => {
            if (selectedFileSet.size === 0) {
              addToast({ type: 'info', message: 'Select file(s) first' });
              return;
            }
            if (selectedFilesPending) {
              addToast({ type: 'info', message: 'Please wait for the current action to finish on the selected file(s).' });
              return;
            }
            if (selectedInUse > 0) {
              addToast({ type: 'warning', message: 'ไฟล์ที่กำลังถูกใช้โดย set (running/pending) ไม่สามารถลบได้ — รอให้ process จบก่อน' });
              return;
            }
            if (!window.confirm(`Delete ${selectedFileSet.size} selected file(s) from Library?`)) return;
            setIsDeleting(true);
            let deleted = 0;
            for (const id of selectedLibraryFileIds) {
              const f = filteredFiles.find((x) => x.id === id);
              if (f && fileNamesInUseByBatch.has(f.name)) continue;
              const ok = await removeUploadedFile(id);
              if (ok) deleted++;
            }
            setIsDeleting(false);
            setSelectedLibraryFileIds([]);
            if (deleted > 0) addToast({ type: 'success', message: `Deleted ${deleted} file(s)` });
          };
          return (
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
              <div className="p-3 flex flex-wrap items-center gap-2 border-b border-slate-200 dark:border-slate-600">
                {/* Removed label pill (visual clutter) */}
                <div
                  className={`w-full mt-2 rounded-xl border-2 border-dashed p-4 flex flex-col sm:flex-row sm:items-center gap-3 ${
                    isImportDragging
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                      : 'border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30'
                  }`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setIsImportDragging(true);
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (!e.currentTarget.contains(e.relatedTarget)) setIsImportDragging(false);
                    }}
                    onDrop={async (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setIsImportDragging(false);
                      const files = await collectFilesFromDataTransfer(e.dataTransfer);
                      if (files?.length) enqueueImportDrafts(files);
                    }}
                    onPaste={(e) => {
                      const items = e.clipboardData?.items || [];
                      const files = [];
                      for (const it of items) {
                        if (it.kind === 'file') {
                          const f = it.getAsFile();
                          if (f) files.push(f);
                        }
                      }
                      if (files.length) enqueueImportDrafts(files);
                    }}
                    tabIndex={0}
                    title="Drop files, paste files, or browse"
                >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0">
                        <Upload size={18} />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">
                          Import files area
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          Drag & drop, paste (Cmd+V), or browse files/folder
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 sm:ml-auto">
                      <input
                        ref={inlineFileImportInputRef}
                        type="file"
                        multiple
                        className="hidden"
                        onChange={(e) => {
                          const files = e.target.files;
                          if (files?.length) enqueueImportDrafts(files);
                          e.target.value = '';
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => inlineFileImportInputRef.current?.click()}
                        disabled={isImporting}
                        className="px-3 py-2 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        Browse
                      </button>
                    </div>
                </div>
                {/* Import preview moved to modal */}
                <div className="w-full grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2 mt-1">
                  <div className="flex items-center gap-2">
                    {['all', 'vcd', 'erom', 'ulp', 'mdi'].map((k) => (
                      <button
                        key={k}
                        onClick={() => setFileFilter(k)}
                        className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border ${
                          fileFilter === k
                            ? 'bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-900/30 dark:border-blue-700'
                            : 'border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        {k === 'all' ? 'All' : k === 'mdi' ? 'MDI' : k.toUpperCase()}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={fileStatusFilter}
                      onChange={(e) => setFileStatusFilter(e.target.value)}
                      className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 w-full"
                    >
                      <option value="all">All status</option>
                      <option value="pending">Pending</option>
                      <option value="running">Running</option>
                      <option value="completed">Completed</option>
                    </select>
                    <select value={fileSort} onChange={(e) => setFileSort(e.target.value)} className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 w-full"><option value="time">Time</option><option value="name">Name</option></select>
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="text" value={fileSearch} onChange={(e) => setFileSearch(e.target.value)} placeholder="Search name" className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 w-full" />
                    <input type="text" value={fileTagSearch} onChange={(e) => setFileTagSearch(e.target.value)} placeholder="Search tag" className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 w-full" />
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="text" value={fileSizeSearch} onChange={(e) => setFileSizeSearch(e.target.value)} placeholder="Search size" className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 w-full" />
                    <input type="text" value={fileOwnerSearch} onChange={(e) => setFileOwnerSearch(e.target.value)} placeholder="Search owner" className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 w-full" />
                  </div>
                </div>
                <div className="w-full flex flex-wrap items-center gap-2 mt-1">
                  <button type="button" onClick={handleDeleteSelectedFiles} disabled={selectedFileSet.size === 0 || selectedInUse > 0 || isDeleting || selectedFilesPending} className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-40 disabled:pointer-events-none transition-colors" title={selectedFilesPending ? 'รอให้ action กับไฟล์ที่เลือกจบก่อน' : selectedInUse > 0 ? 'มีไฟล์ที่กำลังถูกใช้ (running/pending) — ไม่สามารถลบได้' : selectedFileSet.size > 0 ? `Delete ${selectedFileSet.size} selected` : 'Select files to delete'}>
                    <Trash2 size={18} strokeWidth={2} />
                  </button>
                  {selectedFileSet.size > 0 && <span className="text-xs text-slate-500">{selectedFileSet.size} selected{selectedInUse > 0 ? ' (มีรายการที่ล็อก)' : ''}</span>}
                  {selectedFileSet.size > 0 && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <input
                        type="text"
                        value={bulkTagInput}
                        onChange={(e) => setBulkTagInput(e.target.value)}
                        readOnly={selectedFilesPending}
                        onKeyDown={(e) => {
                          if (selectedFilesPending) return;
                          if (e.key !== 'Enter') return;
                          e.preventDefault();
                          const raw = bulkTagInput.trim();
                          if (!raw) return;
                          selectedLibraryFileIds.forEach((id) => {
                            const current = (fileTags && fileTags[id]) || '';
                            const next = upsertTagsString(current, raw);
                            setFileTag?.(id, next);
                          });
                          addToast({ type: 'success', message: `Applied tag(s) to ${selectedLibraryFileIds.length} file(s)` });
                          setBulkTagInput('');
                        }}
                        className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 w-44"
                        placeholder="Bulk add tag… (Enter)"
                        title={selectedFilesPending ? 'รอให้ action กับไฟล์ที่เลือกจบก่อน' : 'Add tags to selected files (comma supported)'}
                      />
                      <button
                        type="button"
                        disabled={selectedFilesPending}
                        onClick={() => {
                          if (selectedFilesPending) return;
                          const raw = bulkTagInput.trim();
                          if (!raw) {
                            addToast({ type: 'info', message: 'Type tag(s) first' });
                            return;
                          }
                          selectedLibraryFileIds.forEach((id) => {
                            const current = (fileTags && fileTags[id]) || '';
                            const next = upsertTagsString(current, raw);
                            setFileTag?.(id, next);
                          });
                          addToast({ type: 'success', message: `Applied tag(s) to ${selectedLibraryFileIds.length} file(s)` });
                          setBulkTagInput('');
                        }}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-200 text-slate-800 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600 disabled:opacity-40 disabled:pointer-events-none"
                        title="Apply tag(s) to selected files"
                      >
                        Apply
                      </button>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedLibraryFileIds.length === 0) {
                        addToast({ type: 'info', message: 'Select file(s) first' });
                        return;
                      }
                      setFileToTestCaseDraft(selectedLibraryFileIds);
                      addToast({
                        type: 'success',
                        message: `Send ${selectedLibraryFileIds.length} files to Create Test Cases — will group by TCxxxx in file name and auto-create rows`,
                      });
                      if (onNavigateToTestCases) onNavigateToTestCases();
                    }}
                    disabled={selectedLibraryFileIds.length === 0}
                    className="ml-auto px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    title="Send selected files to Test Cases builder"
                  >
                    Send to Create Test Case →
                  </button>
                </div>
                {/* Removed "Delete All" action to avoid accidental destructive UX */}
              </div>
              <div className="max-h-[500px] overflow-y-auto overflow-x-auto">
                {loading?.files ? <div className="p-8 text-center text-slate-400">Loading...</div> : errors?.files ? <div className="p-8 text-center text-red-500">{errors.files}</div> : fileViewMode === 'all' ? (
                  filteredFiles.length === 0 ? (
                    <div className="p-8 text-center text-slate-400 space-y-2">
                      <p className="font-medium">No files in library</p>
                      <p className="text-xs max-w-md mx-auto">Files appear here only after you <strong>upload</strong> them on the Test Cases page (drag & drop or click the upload area). Saving a test case only saves the test case definition (names of VCD/ERoM/ULP); it does not upload files. Upload the files first, then save the test case.</p>
                    </div>
                  ) : (
                    <table className="w-full min-w-[1240px] text-left text-xs border-collapse select-none" title="Click and drag across rows to select multiple files">
                      <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-slate-900/95 border-b border-slate-200 dark:border-slate-600">
                        <tr>
                          <th colSpan={10} className="px-2 py-2 text-left bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700">
                            <div className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={selectableFileIds.length > 0 && selectableFileIds.every((id) => selectedFileSet.has(id))}
                                onChange={(e) => {
                                  if (e.target.checked) setSelectedLibraryFileIds([...selectableFileIds]);
                                  else setSelectedLibraryFileIds([]);
                                }}
                                className="w-4 h-4 rounded cursor-pointer"
                                title="Select all (excluding files in use by running/pending set)"
                              />
                              <span className="text-xs text-slate-500 dark:text-slate-400">
                                Select all ({filteredFiles.length})
                                {selectableFileIds.length < filteredFiles.length ? ` — ${filteredFiles.length - selectableFileIds.length} locked (in use)` : ''}
                              </span>
                            </div>
                          </th>
                        </tr>
                        <tr className="text-slate-600 dark:text-slate-300">
                          <th className="w-10 px-2 py-2 font-semibold align-bottom">
                            <span className="sr-only">Select</span>
                          </th>
                          <th className="px-2 py-2 font-semibold min-w-[140px]">Name</th>
                          <th className="w-9 px-1 py-2 font-semibold text-center align-bottom">
                            <span className="sr-only">Rename</span>
                          </th>
                          <th className="px-2 py-2 font-semibold min-w-[140px]">Tags</th>
                          <th className="px-2 py-2 font-semibold min-w-[120px]">Used by TC</th>
                          <th className="px-2 py-2 font-semibold min-w-[100px]" title="Saved sets that reference this file; color follows job status when available">
                            Sets
                          </th>
                          <th className="px-2 py-2 font-semibold w-16">Owner</th>
                          <th className="px-2 py-2 font-semibold w-10 text-center" title="Visibility">
                            Vis
                          </th>
                          <th className="px-2 py-2 font-semibold min-w-[120px]">Modified</th>
                          <th className="px-2 py-2 font-semibold w-24 text-right">Size</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                        {filteredFiles.map((f, index) => {
                          let setNames = getSetNamesUsingFile(f.name, fileReferenceTestCaseSets);
                          const tagVal = (fileTags && fileTags[f.id]) || '';
                          const tags = splitTags(tagVal);
                          let usedByTcs = getTestCasesUsingFile(f.name, fileReferenceTestCases, fileReferenceTestCaseSets);
                          if ((usedByTcs?.length || 0) === 0 || (setNames?.length || 0) === 0) {
                            const fromJobs = getJobRefsUsingFile(f.name, jobs);
                            if ((usedByTcs?.length || 0) === 0) usedByTcs = fromJobs.usedByTcs;
                            if ((setNames?.length || 0) === 0) setNames = fromJobs.setNames;
                          }
                          const isSelected = selectedFileSet.has(f.id);
                          const isFocused = libraryFocusFileName && f.name === libraryFocusFileName;
                          const isHighlighted = isSelected || isFocused;
                          const usedByTcsTitle = usedByTcs.length > 0 ? usedByTcs.map((u) => `${u.name}${u.set ? ` (${u.set})` : ''}`).join('\n') : '';
                          const inUseByBatch = fileNamesInUseByBatch.has(f.name);
                          const isFileClosed = isFileManuallyClosed(f);
                          const isFileInProcess = inUseByBatch;
                          const displayName = (fileDisplayNames && fileDisplayNames[f.id]) || (String(f.name || '').split('/').pop() || f.name);
                          const lastModified = f.updatedAt || f.uploadDate || f.createdAt || null;
                          const fpBusy = !!(filePendingById && filePendingById[f.id]);
                          return (
                            <tr
                              key={f.id}
                              ref={isFocused ? focusedLibraryFileRef : null}
                              title={isFileInProcess && !isFileClosed ? 'Running / Pending — แถวสีเทาเพื่อให้เห็นว่าไฟล์อยู่ใน process (ยังเลือกได้)' : undefined}
                              className={`text-slate-800 dark:text-slate-100 ${fpBusy ? 'ring-1 ring-amber-400/50 dark:ring-amber-500/40' : ''} ${isFileClosed ? 'opacity-75 bg-slate-50/50 dark:bg-slate-800/30 cursor-not-allowed' : 'cursor-pointer'} ${isHighlighted ? 'bg-blue-50 dark:bg-blue-900/20' : isFileInProcess && !isFileClosed ? 'bg-slate-50/90 dark:bg-slate-900/45' : ''} ${isFileInProcess && !isFileClosed ? '[&_td]:text-slate-500 dark:[&_td]:text-slate-400 [&_a]:text-slate-500 dark:[&_a]:text-slate-400' : ''} ${!isHighlighted && !isFileClosed && !isFileInProcess ? 'hover:bg-slate-50 dark:hover:bg-slate-700/40' : ''} ${!isHighlighted && isFileInProcess && !isFileClosed ? 'hover:bg-slate-100/85 dark:hover:bg-slate-800/55' : ''}`}
                              onClick={(e) => {
                                if (e.target.closest('input[type="checkbox"]') || e.target.closest('button') || e.target.closest('input[type="text"]')) return;
                                if (isFileClosed || fpBusy) return;
                                toggleFileSelect(f.id, index, e);
                              }}
                              onMouseDown={(e) => {
                                if (editingDisplayNameFileId) return;
                                if (e.target.closest('input[type="checkbox"]') || e.target.closest('button') || e.target.closest('input[type="text"]')) return;
                                if (isFileClosed || fpBusy) return;
                                if (e.button === 0) {
                                  isDragSelectingFileRef.current = true;
                                  if (!selectedFileSet.has(f.id)) setSelectedLibraryFileIds((prev) => [...prev, f.id]);
                                }
                              }}
                              onMouseEnter={() => {
                                if (editingDisplayNameFileId) return;
                                if (isFileClosed || fpBusy) return;
                                if (!isDragSelectingFileRef.current) return;
                                if (!selectedFileSet.has(f.id)) setSelectedLibraryFileIds((prev) => [...prev, f.id]);
                              }}
                            >
                              <td className="px-2 py-1.5 align-top">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  disabled={isFileClosed || fpBusy}
                                  onChange={() => {
                                    if (!isFileClosed && !fpBusy) toggleFileSelect(f.id, index, { shiftKey: false, ctrlKey: false, metaKey: false });
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                  className={`w-4 h-4 rounded shrink-0 border-slate-300 text-blue-600 ${isFileClosed || fpBusy ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
                                  title={fpBusy ? 'กำลังบันทึก/ลบ — รอสักครู่' : isFileClosed ? 'Vis=close — not selectable' : inUseByBatch ? 'File in use by a running/pending set — cannot delete, but can select' : undefined}
                                />
                              </td>
                              <td className="px-2 py-1.5 align-top min-w-0">
                                {editingDisplayNameFileId === f.id ? (
                                  <input
                                    type="text"
                                    value={renameDraft}
                                    onChange={(e) => setRenameDraft(e.target.value)}
                                    onClick={(e) => e.stopPropagation()}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        skipRenameCommitRef.current = true;
                                        const t = (renameDraft || '').trim();
                                        setFileDisplayName?.(f.id, t);
                                        setEditingDisplayNameFileId(null);
                                        setRenameDraft('');
                                      } else if (e.key === 'Escape') {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        skipRenameCommitRef.current = true;
                                        setEditingDisplayNameFileId(null);
                                        setRenameDraft('');
                                      }
                                    }}
                                    onBlur={() => {
                                      if (skipRenameCommitRef.current) {
                                        skipRenameCommitRef.current = false;
                                        return;
                                      }
                                      const t = (renameDraft || '').trim();
                                      setFileDisplayName?.(f.id, t);
                                      setEditingDisplayNameFileId(null);
                                      setRenameDraft('');
                                    }}
                                    className="w-full min-w-0 text-sm font-medium rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 px-2 py-1"
                                    title={f.name ? `Storage name: ${f.name}` : undefined}
                                    autoFocus
                                  />
                                ) : (
                                  <span className="font-medium text-sm text-slate-700 dark:text-slate-200 break-all" title={f.name ? `File: ${f.name}` : displayName}>
                                    {displayName}
                                  </span>
                                )}
                              </td>
                              <td className="px-1 py-1.5 align-top text-center w-9">
                                {editingDisplayNameFileId === f.id ? (
                                  <span className="inline-block w-7" aria-hidden />
                                ) : (
                                  <button
                                    type="button"
                                    disabled={fpBusy}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (fpBusy) return;
                                      setEditingDisplayNameFileId(f.id);
                                      setRenameDraft(displayName);
                                    }}
                                    className="inline-flex items-center justify-center p-1 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:pointer-events-none"
                                    title="Rename display name (inline)"
                                  >
                                    <Pencil size={14} strokeWidth={2} />
                                  </button>
                                )}
                              </td>
                              <td className="px-2 py-1.5 align-top">
                                <div className="flex flex-wrap items-center gap-1 min-w-0">
                                  {(() => {
                                    const entityKey = `file:${f.id}`;
                                    const { orderedTags } = reorderTagsForDisplayWithIndices(
                                      activeProfileId,
                                      entityKey,
                                      tags,
                                      tags.map(() => null)
                                    );
                                    const displayTags = orderedTags;
                                    return displayTags.slice(0, 3).map((t, ti) => {
                                    const colorKey = FILE_TAG_PALETTE_MAP[fileTagColors?.[f.id]]
                                      ? fileTagColors[f.id]
                                      : 'mint';
                                    const palette =
                                      FILE_TAG_PALETTE_MAP[colorKey] || FILE_TAG_PALETTE_MAP.mint;
                                    return (
                                      <button
                                        key={`${f.id}-tag-${ti}-${t}`}
                                        type="button"
                                        disabled={fpBusy}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          if (fpBusy) return;
                                          const keys = Object.keys(FILE_TAG_PALETTE_MAP);
                                          const cur = fileTagColors?.[f.id] || 'mint';
                                          const idx = Math.max(0, keys.indexOf(cur));
                                          setFileTagColor?.(f.id, keys[(idx + 1) % keys.length]);
                                        }}
                                        className={`px-1.5 py-0.5 rounded-full text-[10px] border font-medium ${palette} hover:brightness-95 disabled:opacity-40 disabled:pointer-events-none`}
                                        title={`${t} — คลิกเพื่อเปลี่ยนสี`}
                                      >
                                        {t}
                                      </button>
                                    );
                                    });
                                  })()}
                                  {tags.length > 0 && (
                                    <button
                                      type="button"
                                      disabled={fpBusy}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (fpBusy) return;
                                        setShowAllUsedByTcForFileName(null);
                                        setShowAllSetsForFileName(null);
                                        setFileTagsModalEditIndex(null);
                                        setFileTagsModalEditDraft('');
                                        setFileTagsModalAddDraft('');
                                        setFileTagsModalAddOpen(false);
                                        setShowAllTagsForFileId(f.id);
                                      }}
                                      className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold border border-slate-200 dark:border-slate-700 bg-white/60 dark:bg-slate-800 text-slate-600 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 shrink-0 disabled:opacity-40 disabled:pointer-events-none"
                                      title="Show all tags"
                                    >
                                      …
                                    </button>
                                  )}
                                  {isTagEditorOpenByFileId[f.id] ? (
                                    <input
                                      type="text"
                                      value={tagInputByFileId[f.id] ?? ''}
                                      readOnly={fpBusy}
                                      onChange={(e) => {
                                        e.stopPropagation();
                                        setTagInputByFileId((prev) => ({ ...prev, [f.id]: e.target.value }));
                                      }}
                                      onKeyDown={(e) => {
                                        if (fpBusy) return;
                                        if (e.key !== 'Enter') return;
                                        e.preventDefault();
                                        e.stopPropagation();
                                        const raw = (tagInputByFileId[f.id] ?? '').trim();
                                        if (!raw) return;
                                        const oldLower = new Set((tags || []).map((t) => String(t).toLowerCase()));
                                        const added = splitTags(raw).filter((t) => !oldLower.has(String(t).toLowerCase()));
                                        if (added.length) recordMyAddedTagsForEntity(activeProfileId, `file:${f.id}`, added);
                                        const next = upsertTagsString(tagVal, raw);
                                        setFileTag?.(f.id, next);
                                        setTagInputByFileId((prev) => ({ ...prev, [f.id]: '' }));
                                        setIsTagEditorOpenByFileId((prev) => ({ ...prev, [f.id]: false }));
                                      }}
                                      onBlur={() => {
                                        setIsTagEditorOpenByFileId((prev) => ({ ...prev, [f.id]: false }));
                                        setTagInputByFileId((prev) => ({ ...prev, [f.id]: '' }));
                                      }}
                                      onClick={(e) => e.stopPropagation()}
                                      className="px-2 py-0.5 text-[11px] rounded-full border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 w-28"
                                      placeholder="tag…"
                                      title="Press Enter to add (comma supported)"
                                      autoFocus
                                    />
                                  ) : (
                                    <button
                                      type="button"
                                      disabled={fpBusy}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (fpBusy) return;
                                        setIsTagEditorOpenByFileId((prev) => ({ ...prev, [f.id]: true }));
                                      }}
                                      className="px-2 py-0.5 rounded-full text-[11px] font-semibold border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 shrink-0 disabled:opacity-40 disabled:pointer-events-none"
                                      title="Add tag"
                                    >
                                      +
                                    </button>
                                  )}
                                </div>
                              </td>
                              <td className="px-2 py-1.5 align-top">
                                <div className="flex flex-wrap items-center gap-1">
                                  {usedByTcs.length === 0 ? (
                                    <span className="text-slate-400">—</span>
                                  ) : (
                                    <>
                                      {usedByTcs.slice(0, 3).map((u, idx) => (
                                        <span
                                          key={`${f.id}-tcchip-${idx}-${u.name}`}
                                          className="px-1.5 py-0.5 rounded-full text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700"
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
                                            setShowAllTagsForFileId(null);
                                            setShowAllSetsForFileName(null);
                                            setShowAllUsedByTcForFileName(f.name);
                                          }}
                                          className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold border border-slate-200 dark:border-slate-700 bg-white/60 dark:bg-slate-800 text-slate-600 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
                                          title={usedByTcsTitle || undefined}
                                        >
                                          …
                                        </button>
                                      )}
                                    </>
                                  )}
                                </div>
                              </td>
                              <td className="px-2 py-1.5 align-top min-w-0">
                                <div className="flex flex-wrap items-center gap-1">
                                  {setNames.length === 0 ? (
                                    <span className="text-slate-400">—</span>
                                  ) : (
                                    <>
                                      {setNames.slice(0, 3).map((sn) => {
                                        const st = setStatusByName.get(sn) ?? null;
                                        return (
                                          <span
                                            key={`${f.id}-setchip-${sn}`}
                                            className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium border max-w-[120px] truncate ${getSetJobStatusPillClass(st)}`}
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
                                            setShowAllTagsForFileId(null);
                                            setShowAllUsedByTcForFileName(null);
                                            setShowAllSetsForFileName(f.name);
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
                              <td className="px-2 py-1.5 align-top text-slate-600 dark:text-slate-300 whitespace-nowrap" title={f.ownerId ? `Owner: ${resolveFileOwnerDisplay(f, ownerLabelCtx)} (${f.ownerId})` : ''}>
                                {resolveFileOwnerDisplay(f, ownerLabelCtx)}
                              </td>
                              <td className="px-2 py-1.5 align-top text-center text-slate-400">
                                <button
                                  type="button"
                                  disabled={fpBusy}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (fpBusy) return;
                                    if (inUseByBatch) {
                                      addToast({ type: 'warning', message: 'File is locked by a running or pending set — cannot change Vis' });
                                      return;
                                    }
                                    const nextClosed = !isFileClosed;
                                    setFileVisById((prev) => ({ ...prev, [f.id]: nextClosed ? 'close' : 'open' }));
                                    setSelectedLibraryFileIds((prev) => prev.filter((id) => id !== f.id));
                                  }}
                                  className={`inline-flex items-center justify-center p-1 rounded ${
                                    fpBusy
                                      ? 'text-amber-500/80 cursor-not-allowed opacity-80'
                                      : inUseByBatch
                                        ? 'text-blue-500 hover:bg-blue-500/10 cursor-not-allowed opacity-80'
                                        : isFileClosed
                                          ? 'text-amber-500 hover:bg-amber-500/10'
                                          : 'text-slate-400 hover:bg-slate-500/10'
                                  }`}
                                  title={
                                    fpBusy
                                      ? 'กำลังบันทึก/ลบ — รอสักครู่'
                                      : inUseByBatch
                                        ? 'Locked by system (running/pending) — system lock'
                                        : isFileClosed
                                          ? 'Closed — click to open/selectable'
                                          : 'Open — click to close/lock from select all'
                                  }
                                >
                                  {inUseByBatch ? <Lock size={14} className="inline" /> : isFileClosed ? <Lock size={14} className="inline" /> : <Globe size={14} className="inline" />}
                                </button>
                              </td>
                              <td className="px-2 py-1.5 align-top whitespace-nowrap text-slate-500 dark:text-slate-400 text-[11px]" title={lastModified ? String(lastModified) : ''}>
                                {lastModified ? String(lastModified).replace('T', ' ').slice(0, 16) : '—'}
                              </td>
                              <td className="px-2 py-1.5 align-top text-right text-slate-600 dark:text-slate-300 whitespace-nowrap">
                                {f.sizeFormatted || f.size || '—'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )
                ) : (
                  <div className="p-3 space-y-4">
                    {filteredFiles.length === 0 ? (
                      <div className="p-8 text-center text-slate-400 space-y-2">
                        <p className="font-medium">No files in library</p>
                        <p className="text-xs max-w-md mx-auto">Upload files on the Test Cases page first (drag & drop or click upload). Save test case only saves the test case definition, not the file content.</p>
                      </div>
                    ) : filesBySet.length === 0 ? <div className="p-8 text-center text-slate-400">No sets — create a set on the Test Cases page (Save Set)</div> : (
                      <>
                        {filteredFiles.length > 0 && (
                          <div className="flex items-center gap-2 pb-2">
                            <input type="checkbox" checked={selectableFileIds.length > 0 && selectableFileIds.every((id) => selectedFileSet.has(id))} onChange={(e) => { if (e.target.checked) setSelectedLibraryFileIds([...selectableFileIds]); else setSelectedLibraryFileIds([]); }} className="w-4 h-4 rounded cursor-pointer" title="Select all (excluding in use)" />
                            <span className="text-xs text-slate-500">Select all ({filteredFiles.length})</span>
                          </div>
                        )}
                        {filesBySet.map(({ set: setInfo, files }, idx) => {
                          if (files.length === 0) return null;
                          const title = setInfo.name || `Set ${idx + 1}`;
                          const boxId = setInfo.id;
                          const isDeletingBox = deletingBoxId === boxId;
                          const boxDeletableFiles = files.filter((f) => !fileNamesInUseByBatch.has(f.name));
                          const boxAllInUse = boxDeletableFiles.length === 0;
                          return (
                            <div key={boxId} className="rounded-lg border border-slate-200 dark:border-slate-600 overflow-hidden bg-slate-50/50 dark:bg-slate-800/30">
                              <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800/50 flex items-center justify-between gap-2">
                                <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{title} <span className="text-xs font-normal text-slate-500">({files.length})</span></span>
                                <button type="button" onClick={() => handleDeleteBox(boxId, files)} disabled={isDeletingBox || boxAllInUse} className={`p-1.5 rounded ${boxAllInUse ? 'opacity-50 cursor-not-allowed text-slate-400' : 'text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20'} disabled:opacity-60`} title={boxAllInUse ? 'ไฟล์ในกล่องนี้กำลังถูกใช้ (running/pending) — ไม่สามารถลบได้' : 'Delete all files in this box'}><Trash2 size={16} strokeWidth={2} /></button>
                              </div>
                              <div className="divide-y divide-slate-100 dark:divide-slate-700">
                                {files.map((f, fileIdx) => {
                                  const isSelected = selectedFileSet.has(f.id);
                                  const globalIndex = filteredFiles.findIndex((x) => x.id === f.id);
                                  let usedByTcs = getTestCasesUsingFile(f.name, fileReferenceTestCases, fileReferenceTestCaseSets);
                                  let setNames = getSetNamesUsingFile(f.name, fileReferenceTestCaseSets);
                                  if ((usedByTcs?.length || 0) === 0 || (setNames?.length || 0) === 0) {
                                    const fromJobs = getJobRefsUsingFile(f.name, jobs);
                                    if ((usedByTcs?.length || 0) === 0) usedByTcs = fromJobs.usedByTcs;
                                    if ((setNames?.length || 0) === 0) setNames = fromJobs.setNames;
                                  }
                                  const usedByTcsTitle = usedByTcs.length > 0 ? usedByTcs.map((u) => `${u.name}${u.set ? ` (${u.set})` : ''}`).join('\n') : '';
                                  const inUseByBatch = fileNamesInUseByBatch.has(f.name);
                                  const fpBusy = !!(filePendingById && filePendingById[f.id]);
                                  const isFileClosedBox = isFileManuallyClosed(f);
                                  const dimFileProcess = inUseByBatch && !isFileClosedBox;
                                  return (
                                    <div
                                      key={f.id}
                                      title={dimFileProcess ? 'Running / Pending — สีเทาเพื่อให้เห็นว่าไฟล์อยู่ใน process (ยังเลือกได้)' : undefined}
                                      className={`flex items-center gap-2 px-4 py-2 flex-wrap select-none bg-white/50 dark:bg-transparent ${fpBusy ? 'ring-1 ring-amber-400/40 dark:ring-amber-500/30' : ''} ${isFileClosedBox ? 'opacity-75 cursor-not-allowed' : 'cursor-pointer'} ${isSelected ? 'bg-blue-50 dark:bg-blue-900/20' : dimFileProcess ? 'bg-slate-50/90 dark:bg-slate-900/40 text-slate-500 dark:text-slate-400' : ''} ${!isSelected && !dimFileProcess && !isFileClosedBox ? 'hover:bg-white dark:hover:bg-slate-800/50' : ''} ${!isSelected && dimFileProcess ? 'hover:bg-slate-100/85 dark:hover:bg-slate-800/50' : ''}`}
                                      onClick={(e) => { if (e.target.closest('input[type="checkbox"]') || e.target.closest('button')) return; if (fpBusy || isFileClosedBox) return; toggleFileSelect(f.id, globalIndex >= 0 ? globalIndex : fileIdx, e); }}
                                      onMouseDown={(e) => { if (e.target.closest('input[type="checkbox"]') || e.target.closest('button')) return; if (fpBusy || isFileClosedBox) return; if (e.button === 0) { isDragSelectingFileRef.current = true; if (!selectedFileSet.has(f.id)) setSelectedLibraryFileIds((prev) => [...prev, f.id]); } }}
                                      onMouseEnter={() => { if (fpBusy || isFileClosedBox) return; if (!isDragSelectingFileRef.current) return; if (!selectedFileSet.has(f.id)) setSelectedLibraryFileIds((prev) => [...prev, f.id]); }}
                                    >
                                      <input type="checkbox" checked={isSelected} disabled={fpBusy || isFileClosedBox} onChange={() => { if (!fpBusy && !isFileClosedBox) toggleFileSelect(f.id, globalIndex >= 0 ? globalIndex : fileIdx, { shiftKey: false, ctrlKey: false, metaKey: false }); }} onClick={(e) => e.stopPropagation()} className={`w-4 h-4 rounded shrink-0 ${fpBusy || isFileClosedBox ? 'cursor-not-allowed opacity-50' : 'cursor-pointer opacity-100'}`} title={fpBusy ? 'กำลังบันทึก/ลบ — รอสักครู่' : isFileClosedBox ? 'Vis=close — not selectable' : inUseByBatch ? 'กำลังถูกใช้โดย set ที่รันอยู่ — เลือกได้ แต่ลบไม่ได้จนกว่า process จบ' : undefined} />
                                      <span className="flex-1 min-w-0 truncate text-sm text-slate-700 dark:text-slate-200">{f.name}</span>
                                      <span className="text-[11px] text-slate-500 dark:text-slate-400 shrink-0 max-w-[70px] truncate" title={f.ownerId ? `Owner: ${resolveFileOwnerDisplay(f, ownerLabelCtx)} (${f.ownerId})` : '—'}>
                                        {resolveFileOwnerDisplay(f, ownerLabelCtx)}
                                      </span>
                                      <span className="shrink-0 text-slate-400 dark:text-slate-500" title={f.visibility || 'public'}>
                                        {f.visibility === 'private' ? <Lock size={14} /> : f.visibility === 'team' ? <Users size={14} /> : <Globe size={14} />}
                                      </span>
                                      {inUseByBatch && (
                                        <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-700 text-[10px] font-semibold shrink-0" title="In use by a running or pending set">In use by set</span>
                                      )}
                                      {usedByTcs.length > 0 && (
                                        <div className="flex items-center gap-1 shrink-0">
                                          {usedByTcs.slice(0, 3).map((u, idx) => (
                                            <span
                                              key={`${f.id}-tcchip-box-${idx}-${u.name}`}
                                              className="px-1.5 py-0.5 rounded-full text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700"
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
                                                setShowAllTagsForFileId(null);
                                                setShowAllSetsForFileName(null);
                                                setShowAllUsedByTcForFileName(f.name);
                                              }}
                                              className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold border border-slate-200 dark:border-slate-700 bg-white/60 dark:bg-slate-800 text-slate-600 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
                                              title={usedByTcsTitle || undefined}
                                            >
                                              …
                                            </button>
                                          )}
                                        </div>
                                      )}
                                      <span className="text-xs text-slate-500 shrink-0">{f.sizeFormatted || f.size}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })() ) }
      {/* Test case history modal */}
      {testCaseHistoryFor && (() => {
        const tc = testCaseHistoryFor.tc;
        const history = getTestCaseHistory(tc);
        const getJobDate = (job) => {
          if (job.status === 'completed' || job.status === 'stopped') {
            if (job.completedAt) return new Date(job.completedAt);
            if (job.startedAt) return new Date(job.startedAt);
          }
          if (job.createdAt) return new Date(job.createdAt);
          if (job.startedAt) return new Date(job.startedAt);
          return new Date();
        };
        const sorted = [...history].sort((a, b) => getJobDate(b.job) - getJobDate(a.job));
        return (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50" onClick={() => setTestCaseHistoryFor(null)}>
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-600 shadow-xl max-w-lg w-full max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-600 flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Test case history</h3>
                <button type="button" onClick={() => setTestCaseHistoryFor(null)} className="p-1.5 rounded text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-600 dark:hover:text-slate-200">
                  <X size={18} />
                </button>
              </div>
              <div className="px-4 py-2 text-xs text-slate-600 dark:text-slate-400 border-b border-slate-100 dark:border-slate-700">
                <span className="font-medium text-slate-700 dark:text-slate-300">{tc.name || '—'}</span>
                {tc.vcdName && <span className="ml-1"> · VCD: {tc.vcdName}</span>}
                {tc.binName && <span> ERoM: {tc.binName}</span>}
                {tc.linName && <span> ULP: {tc.linName}</span>}
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                {sorted.length === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">This test case has not been used in any job/set yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {sorted.map(({ job, fileIndex }, i) => {
                      const status = (job.status || '').toLowerCase();
                      const date = getJobDate(job);
                      // Use the same palette as Job Management status column
                      const statusCls =
                        status === 'completed'
                          ? 'bg-emerald-100 text-emerald-700'
                          : status === 'running'
                          ? 'bg-blue-100 text-blue-700'
                          : status === 'stopped'
                          ? 'bg-red-100 text-red-700'
                          : status === 'pending'
                          ? 'bg-yellow-100 text-yellow-700'
                          : 'bg-slate-100 text-slate-700';
                      return (
                        <li key={`${job.id}-${fileIndex}-${i}`} className="flex items-center justify-between gap-2 py-2 px-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700">
                          <div className="min-w-0">
                            <div className="font-medium text-slate-800 dark:text-slate-200 truncate">{job.name || job.configName || `Job #${job.id}`}</div>
                            <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                              {date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                              {(job.files?.length || 0) > 1 && <span className="ml-1"> · Order: {fileIndex + 1}</span>}
                            </div>
                          </div>
                          <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold capitalize ${statusCls}`}>{status || '—'}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default FileLibraryPage;
