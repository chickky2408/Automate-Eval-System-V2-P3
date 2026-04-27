// import { create } from 'zustand';

// export const useTestStore = create((set) => ({
//   vcdFiles: [],
//   firmwareFiles: [],
//   jobQueue: [],
  
//   // Actions
//   addVcdFile: (file) => set((state) => ({ vcdFiles: [...state.vcdFiles, file] })),
//   addFirmwareFile: (file) => set((state) => ({ firmwareFiles: [...state.firmwareFiles, file] })),
  
//   addJob: (newJob) => set((state) => ({ jobQueue: [...state.jobQueue, newJob] })),
//   updateJobStatus: (id, status) => set((state) => ({
//     jobQueue: state.jobQueue.map(j => j.id === id ? { ...j, status } : j)
//   })),
//   removeJob: (id) => set((state) => ({
//     jobQueue: state.jobQueue.filter(j => j.id !== id)
//   })),
//   reorderJobs: (newOrder) => set({ jobQueue: newOrder }),
// }));




import { create } from 'zustand';
import { getClientId } from '../utils/sessionStorage';
import { isValidPaletteKey, TAG_PALETTE_MAP, splitTagsComma } from '../utils/tagPalette';
import { rememberClientOwnerLabel, syncOwnerLabelsFromJobs, syncOwnerLabelsFromFiles } from '../utils/profileOwnerLabel';
import api from '../services/api';

/** Auto-dismiss timer for in-app job alert overlay */
let jobAttentionBannerTimer = null;

function isJobOwnedByActiveProfile(job, activeProfileId, clientId) {
  const pid = job?.profileId ?? job?.profile_id;
  const cid = job?.clientId ?? job?.client_id;
  const pidStr = pid != null ? String(pid).trim() : '';
  if (activeProfileId && pidStr !== '' && pidStr === String(activeProfileId)) return true;
  if (pidStr === '' && cid != null && clientId && String(cid) === String(clientId)) return true;
  return false;
}

function fileIsFail(file) {
  if (!file) return false;
  const r = (file.result || '').toLowerCase();
  const s = (file.status || '').toLowerCase();
  return r === 'fail' || s === 'error';
}

function resolvePrevFile(prevFiles, file, idx) {
  if (!prevFiles?.length) return undefined;
  if (file?.id != null) return prevFiles.find((f) => f.id === file.id);
  return prevFiles[idx];
}

/** Owner-scoped job notification rows; includes _attention (show overlay) for side effects. */
function buildMyJobLocalNotifications(prevJobs, nextJobs, activeProfileId, clientId) {
  const prevList = prevJobs || [];
  const nextList = nextJobs || [];
  const now = new Date().toISOString();
  const out = [];

  for (const j of nextList) {
    if (!isJobOwnedByActiveProfile(j, activeProfileId, clientId)) continue;
    const prev = prevList.find((p) => p.id === j.id);
    const wasRunning = (prev?.status || '').toLowerCase() === 'running';
    const st = (j.status || '').toLowerCase();
    const nowDone = st === 'completed' || st === 'stopped';

    if (wasRunning && nowDone) {
      const anyFail = (j.files || []).some(fileIsFail);
      const title =
        st === 'stopped' ? 'Set stopped' : anyFail ? 'Set finished with failures' : 'Set completed';
      const message =
        st === 'stopped'
          ? `Set #${j.id} (${j.name || 'Unnamed'}) was stopped.`
          : anyFail
            ? `Set #${j.id} (${j.name || 'Unnamed'}) finished — some test cases failed.`
            : `Set #${j.id} (${j.name || 'Unnamed'}) finished successfully.`;
      const type = st === 'stopped' ? 'info' : anyFail ? 'error' : 'success';
      out.push({
        id: `local-${j.id}-done-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        title,
        message,
        type,
        read: false,
        createdAt: now,
        data: { jobId: j.id },
        _attention: st === 'completed' || (st === 'stopped' && anyFail),
      });
    }

    if (st === 'running') {
      const prevFiles = prev?.files || [];
      (j.files || []).forEach((file, idx) => {
        const pFile = resolvePrevFile(prevFiles, file, idx);
        if (fileIsFail(file) && !fileIsFail(pFile)) {
          const name = file.testCaseName || file.name || `Test case #${idx + 1}`;
          out.push({
            id: `local-${j.id}-tc-${file.id ?? idx}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            title: 'Test case error',
            message: `${name} failed while running (Set #${j.id}).`,
            type: 'error',
            read: false,
            createdAt: now,
            data: { jobId: j.id, fileId: file.id },
            _attention: true,
          });
        }
      });
    }
  }

  return out;
}

function stripAttentionFields(row) {
  const { _attention, ...rest } = row;
  return rest;
}

// Load test commands from localStorage
const loadTestCommands = () => {
  try {
    const saved = localStorage.getItem('userTestCommands');
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (e) {
    console.error('Failed to load test commands from localStorage', e);
  }
  return null;
};

// Save test commands to localStorage
const saveTestCommands = (commands) => {
  try {
    localStorage.setItem('userTestCommands', JSON.stringify(commands));
  } catch (e) {
    console.error('Failed to save test commands to localStorage', e);
  }
};

// ============================================
// PROFILE SYSTEM (no login/logout)
// ============================================
const PROFILES_LIST_KEY = 'app_profiles_list';
const ACTIVE_PROFILE_ID_KEY = 'app_active_profile_id';
const PROFILE_DATA_PREFIX = 'app_profile_';
const FILE_TAGS_KEY = 'app_file_tags';
const FILE_TAG_COLORS_KEY = 'app_file_tag_colors';
const FILE_DISPLAY_NAMES_KEY = 'app_file_display_names';
const SHARED_PROFILES_KEY = 'app_shared_profiles';
const RUN_BOARD_SELECTION_KEY = 'app_run_board_selection';

// True if profile id is a backend UUID (can sync / share)
const isBackendProfileId = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(id || ''));

// Load profiles list
const loadProfilesList = () => {
  try {
    const saved = localStorage.getItem(PROFILES_LIST_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch (e) {
    console.error('Failed to load profiles list', e);
  }
  return [];
};

// Save profiles list
const saveProfilesList = (list) => {
  try {
    localStorage.setItem(PROFILES_LIST_KEY, JSON.stringify(list));
  } catch (e) {
    console.error('Failed to save profiles list', e);
  }
};

const loadRunBoardSelection = () => {
  try {
    const saved = localStorage.getItem(RUN_BOARD_SELECTION_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && typeof parsed.mode === 'string' && Array.isArray(parsed.boardIds)) {
        return { mode: parsed.mode === 'manual' ? 'manual' : 'auto', boardIds: parsed.boardIds };
      }
    }
  } catch (e) {
    console.error('Failed to load run board selection', e);
  }
  return { mode: 'auto', boardIds: [] };
};

const saveRunBoardSelection = (data) => {
  try {
    localStorage.setItem(RUN_BOARD_SELECTION_KEY, JSON.stringify({
      mode: data.mode === 'manual' ? 'manual' : 'auto',
      boardIds: Array.isArray(data.boardIds) ? data.boardIds : [],
    }));
  } catch (e) {
    console.error('Failed to save run board selection', e);
  }
};

// Load shared profiles list [{ id, name? }]
const loadSharedProfilesList = () => {
  try {
    const saved = localStorage.getItem(SHARED_PROFILES_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch (e) {
    console.error('Failed to load shared profiles list', e);
  }
  return [];
};

const saveSharedProfilesList = (list) => {
  try {
    localStorage.setItem(SHARED_PROFILES_KEY, JSON.stringify(list));
  } catch (e) {
    console.error('Failed to save shared profiles list', e);
  }
};

// Load a profile by id
const loadProfile = (profileId) => {
  try {
    const saved = localStorage.getItem(`${PROFILE_DATA_PREFIX}${profileId}`);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (e) {
    console.error(`Failed to load profile ${profileId}`, e);
  }
  return null;
};

// Save a profile
const saveProfile = (profileId, profileData) => {
  try {
    const updated = { ...profileData, updatedAt: new Date().toISOString() };
    localStorage.setItem(`${PROFILE_DATA_PREFIX}${profileId}`, JSON.stringify(updated));
  } catch (e) {
    console.error(`Failed to save profile ${profileId}`, e);
  }
};

/** Display name for the active profile (server job owner snapshot). */
const getActiveProfileDisplayNameForSnapshot = (get) => {
  const profileId = get().activeProfileId;
  const p = (get().profiles || []).find((x) => x.id === profileId);
  const n = p?.name;
  return typeof n === 'string' && n.trim() ? n.trim() : null;
};

// File tags (global, per-device)
const loadFileTags = () => {
  try {
    const raw = localStorage.getItem(FILE_TAGS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    console.error('Failed to load file tags', e);
    return {};
  }
};

const saveFileTags = (tags) => {
  try {
    localStorage.setItem(FILE_TAGS_KEY, JSON.stringify(tags || {}));
  } catch (e) {
    console.error('Failed to save file tags', e);
  }
};

const loadFileTagColors = () => {
  try {
    const raw = localStorage.getItem(FILE_TAG_COLORS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    console.error('Failed to load file tag colors', e);
    return {};
  }
};

const saveFileTagColors = (colors) => {
  try {
    localStorage.setItem(FILE_TAG_COLORS_KEY, JSON.stringify(colors || {}));
  } catch (e) {
    console.error('Failed to save file tag colors', e);
  }
};

/** One-time sync: legacy localStorage tags → server so all profiles see the same tags. */
const migrateLocalFileTagsToServer = async (files) => {
  const localTags = loadFileTags();
  const localColors = loadFileTagColors();
  const needs = (files || []).filter((f) => {
    const hasServer = 'tags' in f && f.tags != null && String(f.tags).trim() !== '';
    return !hasServer && localTags[f.id] && String(localTags[f.id]).trim();
  });
  if (!needs.length) return false;
  await Promise.allSettled(
    needs.map((f) => {
      const p = { tags: localTags[f.id] };
      if (localColors[f.id]) p.tagColor = localColors[f.id];
      return api.patchFileLibraryTags(f.id, p);
    })
  );
  return true;
};

/** Merge GET /files rows into fileTags / fileTagColors (server wins for each file row that includes keys). */
const buildFileTagMapsFromApiFiles = (files) => {
  const localTags = loadFileTags();
  const localColors = loadFileTagColors();
  const tagMap = { ...localTags };
  const colorMap = { ...localColors };
  (files || []).forEach((file) => {
    const id = file.id;
    if ('tags' in file) {
      tagMap[id] = file.tags != null && String(file.tags).trim() !== '' ? String(file.tags) : '';
    }
    if ('tagColor' in file) {
      const c = file.tagColor;
      if (c != null && String(c).trim() !== '') colorMap[id] = String(c).trim();
      else delete colorMap[id];
    }
  });
  return { fileTags: tagMap, fileTagColors: colorMap };
};

/** Merge comma-separated tags (case-insensitive dedup; keep first-seen order). */
const mergeCommaTagStrings = (a, b) => {
  const sa = String(a || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  const sb = String(b || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  const seen = new Set(sa.map((x) => x.toLowerCase()));
  const out = [...sa];
  sb.forEach((t) => {
    const k = t.toLowerCase();
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push(t);
  });
  return out.join(', ');
};

/**
 * Merge two saved test case rows with the same `id` (server snapshot + per-profile localStorage).
 * Without this, server rows win and drop tags / files that exist only locally → Library "All" shows "No tag".
 */
const mergeSavedTestCaseRow = (a, b) => {
  if (!a) return b;
  if (!b) return a;
  const out = { ...a, ...b };
  const exA = a.extraColumns && typeof a.extraColumns === 'object' ? a.extraColumns : {};
  const exB = b.extraColumns && typeof b.extraColumns === 'object' ? b.extraColumns : {};
  const tagA = String(exA.tag ?? exA.Tag ?? '').trim();
  const tagB = String(exB.tag ?? exB.Tag ?? '').trim();
  out.extraColumns = { ...exA, ...exB };
  const mergedTag = mergeCommaTagStrings(tagA, tagB);
  if (mergedTag) {
    out.extraColumns.tag = mergedTag;
    if (out.extraColumns.Tag) delete out.extraColumns.Tag;
  }
  if ((!exA.tagColor && !exA.tag_color) && (exB.tagColor || exB.tag_color)) {
    out.extraColumns.tagColor = exB.tagColor || exB.tag_color;
  }
  if ((!exA.tagColorList || !exA.tagColorList.length) && Array.isArray(exB.tagColorList) && exB.tagColorList.length) {
    out.extraColumns.tagColorList = exB.tagColorList;
  }
  ['vcdName', 'binName', 'linName'].forEach((k) => {
    if (!(out[k] || '').trim()) {
      if ((a[k] || '').trim()) out[k] = a[k];
      else if ((b[k] || '').trim()) out[k] = b[k];
    }
  });
  if ((!a.commands || !a.commands.length) && b.commands?.length) {
    out.commands = b.commands;
  }
  return out;
};

/** Merge two saved sets with the same `id` (merge items by test case id). */
const mergeSavedSetRow = (a, b) => {
  if (!a) return b;
  if (!b) return a;
  const out = { ...a, ...b };
  const itemsA = Array.isArray(a.items) ? a.items : [];
  const itemsB = Array.isArray(b.items) ? b.items : [];
  const byTcId = new Map();
  const push = (tc, ownerId, ownerName) => {
    if (!tc || tc.id == null) return;
    const id = String(tc.id);
    const row = {
      ...tc,
      _ownerId: tc._ownerId ?? ownerId,
      _ownerName: tc._ownerName ?? ownerName,
    };
    if (!byTcId.has(id)) {
      byTcId.set(id, row);
    } else {
      byTcId.set(id, mergeSavedTestCaseRow(byTcId.get(id), row));
    }
  };
  itemsA.forEach((tc) => push(tc, a._ownerId, a._ownerName));
  itemsB.forEach((tc) => push(tc, b._ownerId, b._ownerName));
  out.items = Array.from(byTcId.values());
  return out;
};

const loadFileDisplayNames = () => {
  try {
    const raw = localStorage.getItem(FILE_DISPLAY_NAMES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    console.error('Failed to load file display names', e);
    return {};
  }
};

const saveFileDisplayNames = (names) => {
  try {
    localStorage.setItem(FILE_DISPLAY_NAMES_KEY, JSON.stringify(names || {}));
  } catch (e) {
    console.error('Failed to save file display names', e);
  }
};

/** Per-file Vis lock (open/close) — File Library + Test Cases browse modal share this */
const FILE_VIS_BY_ID_KEY = 'fileVisById';
const loadFileVisById = () => {
  try {
    const raw = localStorage.getItem(FILE_VIS_BY_ID_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    console.error('Failed to load fileVisById', e);
    return {};
  }
};
const saveFileVisById = (obj) => {
  try {
    localStorage.setItem(FILE_VIS_BY_ID_KEY, JSON.stringify(obj || {}));
  } catch (e) {
    console.error('Failed to save fileVisById', e);
  }
};

// Get active profile id (or create default)
const getActiveProfileId = () => {
  try {
    const saved = localStorage.getItem(ACTIVE_PROFILE_ID_KEY);
    if (saved) return saved;
  } catch (e) {
    console.error('Failed to get active profile id', e);
  }
  // No active profile - check if we have old savedTestCases to migrate
  const oldData = localStorage.getItem('appSavedTestCases');
  if (oldData) {
    try {
      const oldCases = JSON.parse(oldData);
      if (Array.isArray(oldCases) && oldCases.length > 0) {
        // Migrate to default profile
        const defaultId = 'default';
        const defaultProfile = {
          id: defaultId,
          name: 'Default',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          savedTestCases: oldCases,
          savedTestCaseSets: [],
          preferences: {},
        };
        saveProfile(defaultId, defaultProfile);
        saveProfilesList([{ id: defaultId, name: 'Default' }]);
        localStorage.setItem(ACTIVE_PROFILE_ID_KEY, defaultId);
        localStorage.removeItem('appSavedTestCases'); // Clean up old data
        return defaultId;
      }
    } catch (e) {
      console.error('Failed to migrate old test cases', e);
    }
  }
  // Create default profile
  const defaultId = 'default';
  const defaultProfile = {
    id: defaultId,
    name: 'Default',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    savedTestCases: [],
    savedTestCaseSets: [],
    preferences: {},
  };
  saveProfile(defaultId, defaultProfile);
  saveProfilesList([{ id: defaultId, name: 'Default' }]);
  localStorage.setItem(ACTIVE_PROFILE_ID_KEY, defaultId);
  return defaultId;
};

// Load saved test cases from active profile
const loadSavedTestCases = () => {
  const activeId = getActiveProfileId();
  const profile = loadProfile(activeId);
  return profile?.savedTestCases || [];
  
};

// After backend profile PUT, refresh merged TC data for all profiles (debounced).
let globalTestCaseDataRefreshTimer = null;
let scheduleGlobalTestCaseDataRefresh = () => {};

// Save saved test cases to active profile (and sync to backend if profile is backend UUID)
const saveSavedTestCases = (list) => {
  const activeId = getActiveProfileId();
  const profile = loadProfile(activeId);
  if (profile) {
    saveProfile(activeId, { ...profile, savedTestCases: list });
  } else {
    const newProfile = {
      id: activeId,
      name: 'Default',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      savedTestCases: list,
      savedTestCaseSets: [],
      preferences: {},
    };
    saveProfile(activeId, newProfile);
  }
  if (isBackendProfileId(activeId)) {
    const p = loadProfile(activeId);
    void api.putProfileData(activeId, { savedTestCases: list, savedTestCaseSets: p?.savedTestCaseSets ?? [] }).catch((err) => {
      console.error('[putProfileData failed: savedTestCases]', err);
      try { useTestStore.getState().addToast?.({ type: 'error', message: `Save to server failed: ${err?.message || err}` }); } catch { /* ignore */ }
    });
    scheduleGlobalTestCaseDataRefresh();
  }
};

// Load saved test case sets (collections) from active profile
const loadSavedTestCaseSets = () => {
  const activeId = getActiveProfileId();
  const profile = loadProfile(activeId);
  return profile?.savedTestCaseSets || [];
};

// Save saved test case sets to active profile (and sync to backend if profile is backend UUID)
const saveSavedTestCaseSets = (sets) => {
  const activeId = getActiveProfileId();
  const profile = loadProfile(activeId);
  if (profile) {
    saveProfile(activeId, { ...profile, savedTestCaseSets: sets });
  } else {
    const newProfile = {
      id: activeId,
      name: 'Default',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      savedTestCases: [],
      savedTestCaseSets: sets,
      preferences: {},
    };
    saveProfile(activeId, newProfile);
  }
  if (isBackendProfileId(activeId)) {
    const p = loadProfile(activeId);
    void api.putProfileData(activeId, { savedTestCases: p?.savedTestCases ?? [], savedTestCaseSets: sets }).catch((err) => {
      console.error('[putProfileData failed: savedTestCaseSets]', err);
      try { useTestStore.getState().addToast?.({ type: 'error', message: `Save set to server failed: ${err?.message || err}` }); } catch { /* ignore */ }
    });
    scheduleGlobalTestCaseDataRefresh();
  }
};

// Helper function to format file size
const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
};

const inferFileType = (name, typeHint) => {
  const h = typeHint != null ? String(typeHint).trim().toLowerCase() : '';
  if (h === 'vcd') return 'vcd';
  if (h === 'erom' || h === 'firmware') return 'erom';
  if (h === 'ulp') return 'ulp';
  if (h === 'txt') return 'mdi';
  if (h === 'script') return 'script';
  const ext = String(name || '').split('.').pop()?.toLowerCase();
  if (ext === 'vcd') return 'vcd';
  if (['erom', 'bin', 'hex', 'elf'].includes(ext)) return 'erom';
  if (['ulp', 'lin'].includes(ext)) return 'ulp';
  if (ext === 'txt') return 'mdi';
  return 'firmware';
};

/** Trimmed display name — global uniqueness uses this string (all profiles + shared cache). */
const normalizeTestCaseName = (name) => (name || '').trim();

/** Last-modified timestamp for saved test cases (ISO string). */
const testCaseNowIso = () => new Date().toISOString();

const normalizeFilenameForKey = (v) => String(v || '').trim().toLowerCase();

/**
 * File signature key for a saved test case.
 * Used to prevent saving an identical TC (same VCD/ERoM/ULP/MDI set) more than once.
 */
const getTestCaseFilesKey = (tc) => {
  if (!tc || typeof tc !== 'object') return '';
  const vcd = normalizeFilenameForKey(tc.vcdName);
  const bin = normalizeFilenameForKey(tc.binName);
  const lin = normalizeFilenameForKey(tc.linName);
  const ex = tc.extraColumns && typeof tc.extraColumns === 'object' ? tc.extraColumns : {};
  const extraPairs = Object.keys(ex)
    // include extra VCD/ERoM/ULP/MDI columns (e.g. VCD2, ERoM2, ULP2, MDI1)
    .filter((k) => /^(vcd|erom|ulp|mdi)\d+$/i.test(String(k)))
    .map((k) => {
      const vv = normalizeFilenameForKey(ex[k]);
      return vv ? `${String(k).toUpperCase()}=${vv}` : null;
    })
    .filter(Boolean)
    .sort((a, b) => String(a).localeCompare(String(b)));
  return [vcd, bin, lin, ...extraPairs].join('\0');
};

/** Same logical identity as FileLibraryPage `tcSignatureKeyForDedupe` (VCD/ERoM/ULP + extra erom/ulp/mdi + MDI commands). */
const getExtendedTestCaseKey = (tc) => {
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

/** Lets a set copy reuse the same display name as the library TC with identical file bundle (different id). */
function subtractNamesFromSharedTestCaseSignature(used, tc, state) {
  const k = getExtendedTestCaseKey(tc);
  if (!k) return;
  const walk = (row) => {
    if (!row) return;
    if (getExtendedTestCaseKey(row) !== k) return;
    const n = normalizeTestCaseName(row.name);
    if (n) used.delete(n);
  };
  (state.savedTestCases || []).forEach(walk);
  (state.savedTestCaseSets || []).forEach((set) => (set.items || []).forEach(walk));
  (state.loadedSetTable || []).forEach(walk);
  (state.workingTestCases || []).forEach(walk);
  const cache = state.sharedProfileDataCache || {};
  Object.values(cache).forEach((data) => {
    if (!data) return;
    (data.savedTestCases || []).forEach(walk);
    (data.savedTestCaseSets || []).forEach((set) => (set.items || []).forEach(walk));
  });
  const activeId = state.activeProfileId;
  for (const p of loadProfilesList()) {
    const prof =
      p.id === activeId
        ? { savedTestCases: state.savedTestCases, savedTestCaseSets: state.savedTestCaseSets }
        : loadProfile(p.id);
    if (!prof) continue;
    (prof.savedTestCases || []).forEach(walk);
    (prof.savedTestCaseSets || []).forEach((set) => (set.items || []).forEach(walk));
  }
}

function collectFileNamesFromTestCaseForSetSnapshot(tc) {
  const names = new Set();
  const add = (n) => {
    const s = (n ?? '').toString().trim();
    if (s) names.add(s);
  };
  if (!tc || typeof tc !== 'object') return [];
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
}

/**
 * All in-use test case names across every local profile, shared profile cache, loaded set, working list, and optional extra rows (e.g. drafts).
 * @param excludeId — test case id to ignore (when renaming that row)
 */
const buildGlobalTestCaseNameSet = (state, excludeId, extraTestCaseLists = []) => {
  const ex = excludeId == null ? null : String(excludeId);
  const names = new Set();
  const addTc = (tc) => {
    if (!tc) return;
    if (ex && String(tc.id) === ex) return;
    const n = normalizeTestCaseName(tc.name);
    if (n) names.add(n);
  };
  (state.loadedSetTable || []).forEach(addTc);
  (state.workingTestCases || []).forEach(addTc);
  const cache = state.sharedProfileDataCache || {};
  Object.values(cache).forEach((data) => {
    if (!data) return;
    (data.savedTestCases || []).forEach(addTc);
    (data.savedTestCaseSets || []).forEach((set) => {
      (set.items || []).forEach(addTc);
    });
  });
  const activeId = state.activeProfileId;
  for (const p of loadProfilesList()) {
    const prof =
      p.id === activeId
        ? { savedTestCases: state.savedTestCases, savedTestCaseSets: state.savedTestCaseSets }
        : loadProfile(p.id);
    if (!prof) continue;
    (prof.savedTestCases || []).forEach(addTc);
    (prof.savedTestCaseSets || []).forEach((set) => {
      (set.items || []).forEach(addTc);
    });
  }
  for (const list of extraTestCaseLists) {
    (list || []).forEach(addTc);
  }
  return names;
};

const pickUniqueTestCaseName = (desired, usedSet) => {
  const base = normalizeTestCaseName(desired) || 'Test case';
  if (!usedSet.has(base)) return base;
  let n = 2;
  while (usedSet.has(`${base} (${n})`)) n += 1;
  return `${base} (${n})`;
};

export const useTestStore = create((set, get) => {
  const beginFilePending = (fileId, kind) => {
    if (!fileId) return false;
    const cur = get().filePendingById || {};
    if (cur[fileId]) {
      get().addToast({
        type: 'info',
        message: 'Please wait for the current action to finish before changing this file.',
        duration: 2800,
      });
      return false;
    }
    set((s) => ({ filePendingById: { ...(s.filePendingById || {}), [fileId]: kind } }));
    return true;
  };
  const endFilePending = (fileId) => {
    if (!fileId) return;
    set((s) => {
      const next = { ...(s.filePendingById || {}) };
      delete next[fileId];
      return { filePendingById: next };
    });
  };

  const beginTestCasePending = (tcId, kind) => {
    if (tcId == null || tcId === '') return false;
    const key = String(tcId);
    const cur = get().testCasePendingById || {};
    if (cur[key]) {
      get().addToast({
        type: 'info',
        message: 'Please wait for the current action to finish before changing this test case.',
        duration: 2800,
      });
      return false;
    }
    set((s) => ({ testCasePendingById: { ...(s.testCasePendingById || {}), [key]: kind } }));
    return true;
  };
  const endTestCasePending = (tcId) => {
    if (tcId == null || tcId === '') return;
    const key = String(tcId);
    set((s) => {
      const next = { ...(s.testCasePendingById || {}) };
      delete next[key];
      return { testCasePendingById: next };
    });
  };

  const beginSavedTestCaseSetPending = (setId, kind) => {
    if (setId == null || setId === '') return false;
    const key = String(setId);
    const cur = get().savedTestCaseSetPendingById || {};
    if (cur[key]) {
      get().addToast({
        type: 'info',
        message: 'Please wait for the current action to finish before changing this set.',
        duration: 2800,
      });
      return false;
    }
    set((s) => ({
      savedTestCaseSetPendingById: { ...(s.savedTestCaseSetPendingById || {}), [key]: kind },
    }));
    return true;
  };
  const endSavedTestCaseSetPending = (setId) => {
    if (setId == null || setId === '') return;
    const key = String(setId);
    set((s) => {
      const next = { ...(s.savedTestCaseSetPendingById || {}) };
      delete next[key];
      return { savedTestCaseSetPendingById: next };
    });
  };

  scheduleGlobalTestCaseDataRefresh = () => {
    if (globalTestCaseDataRefreshTimer) clearTimeout(globalTestCaseDataRefreshTimer);
    globalTestCaseDataRefreshTimer = setTimeout(() => {
      globalTestCaseDataRefreshTimer = null;
      void get().refreshGlobalTestCaseData();
    }, 400);
  };
  return {
  // System Health
  systemHealth: {
    totalBoards: 0,
    onlineBoards: 0,
    busyBoards: 0,
    errorBoards: 0,
    staleBoards: 0,
    storageUsage: 0, // percentage
    storageTotal: '0B',
    storageUsed: '0B',
    boardApiStatus: 'offline' // 'online' | 'offline'
  },
  
  // Boards/Devices
  boards: [],
  boardQueuePaused: {},
  
  // Jobs/Batches
  jobs: [],
  
  // Notifications (from API)
  notifications: [],
  // Local notifications (e.g. job completed - frontend only)
  localNotifications: [],

  // Common Commands (normally use)
  commonCommands: [],
  
  // Test Code Commands (pre-written test commands)
  // Load from localStorage or use default
  testCommands: (() => {
    const saved = loadTestCommands();
    if (saved && saved.length > 0) {
      return saved;
    }
    return [];
  })(),
  
  uploadedFiles: [],
  vcdFiles: [],
  firmwareFiles: [],

  // File metadata (per device) — tags keyed by file.id
  fileTags: (() => loadFileTags())(),
  /** Accent color key for tag pills in File Library (mint | sky | …) */
  fileTagColors: (() => loadFileTagColors())(),
  fileDisplayNames: (() => loadFileDisplayNames())(),
  /** { [fileId]: 'open' | 'close' } — UI lock for select-all / jump-select; persisted */
  fileVisById: (() => loadFileVisById())(),
  /** One in-flight server mutation per file: delete vs tag PATCH */
  filePendingById: {},
  /** One discrete mutation per saved TC id (delete / duplicate / reorder) — not used for inline edits */
  testCasePendingById: {},
  /** One discrete mutation per saved set id — not used for updateSavedTestCaseSet (rename / item saves / job patches) */
  savedTestCaseSetPendingById: {},
  setFileVisById: (updater) =>
    set((state) => {
      const prev = state.fileVisById || {};
      const next =
        typeof updater === 'function'
          ? updater(prev)
          : { ...prev, ...(updater && typeof updater === 'object' ? updater : {}) };
      saveFileVisById(next);
      return { fileVisById: next };
    }),

  // Saved Test Cases (library) — persisted; only shown in Library after "Save to library"
  savedTestCases: (() => loadSavedTestCases())(),

  // Working Test Cases (draft) — table content; NOT in Library until user clicks "Save to library"
  workingTestCases: [],

  // Saved Test Case Sets — snapshot ของชุด test cases ทั้งตาราง (ไม่ต้องใช้ JSON เอง)
  savedTestCaseSets: (() => loadSavedTestCaseSets())(),

  /** GET /profiles/all-test-cases — merged across all server profiles (File Library "Used by TC" / Sets). */
  globalSavedTestCases: [],
  globalSavedTestCaseSets: [],
  globalTestCaseDataLoaded: false,

  // Profile System (no login/logout)
  profiles: (() => loadProfilesList())(),
  activeProfileId: (() => getActiveProfileId())(),
  sharedProfiles: (() => loadSharedProfilesList())(),
  /** From GET /profiles — names for every profile on server (for Owner column: other users). */
  serverProfileDirectory: [],
  viewingSharedProfileId: null,
  sharedProfileDataCache: {}, // { [profileId]: { savedTestCases, savedTestCaseSets } }
  /** Bumps when `preferences.tcViewerTagOverlays` changes (per-viewer tags on others' library TCs). */
  tcViewerTagEpoch: 0,

  // When editing a set (Load): table shows only set items; library (savedTestCases) is never touched
  loadedSetId: null,
  loadedSetTable: [], // test cases in table when editing a set (only set's items)

  // When Library triggers "edit this test case" → Test Cases page loads this set and focuses row
  libraryEditContext: null, // { loadSetId: string, focusTcIndex?: number } | null
  setLibraryEditContext: (ctx) => set({ libraryEditContext: ctx }),
  clearLibraryEditContext: () => set({ libraryEditContext: null }),

  // When JobsPage (or other) wants to navigate to File Library and focus a file
  libraryFocusFileNameOnNavigate: null,
  setLibraryFocusFileNameOnNavigate: (name) => set({ libraryFocusFileNameOnNavigate: name }),
  clearLibraryFocusFileNameOnNavigate: () => set({ libraryFocusFileNameOnNavigate: null }),

  // When navigating to File Library, force which tab/view to open.
  // Used for a continuous workflow (e.g. after "Save to library" from Test Cases).
  fileLibraryViewOnNavigate: null, // 'files' | 'rawTestCases' | 'testCases'
  setFileLibraryViewOnNavigate: (view) => set({ fileLibraryViewOnNavigate: view }),
  clearFileLibraryViewOnNavigate: () => set({ fileLibraryViewOnNavigate: null }),

  // When JobsPage wants to navigate to Test Cases tab and auto-select a test case row (by name/vcd/bin/lin)
  testCaseLibraryFocusOnNavigate: null,
  setTestCaseLibraryFocusOnNavigate: (payload) => set({ testCaseLibraryFocusOnNavigate: payload }),
  clearTestCaseLibraryFocusOnNavigate: () => set({ testCaseLibraryFocusOnNavigate: null }),

  /** Dashboard System Summary filters — persist across SPA navigation; reset on full page refresh */
  dashboardSystemSummary: {
    systemSearch: '',
    systemStatusFilter: 'all',
    systemTagFilter: '',
    systemTagColorFilter: '',
    // Use a sentinel that is resolved to the current active profile on first load.
    // This makes a fresh refresh default to "my profile" while still persisting any user-changed filters in SPA navigation.
    systemOwnerFilter: '__active__',
    systemBoardFilter: 'all',
    systemDateFilter: '',
    isSystemSummaryExpanded: false,
  },
  setDashboardSystemSummary: (updater) =>
    set((state) => {
      const prev = state.dashboardSystemSummary;
      const next =
        typeof updater === 'function'
          ? updater(prev)
          : { ...prev, ...(updater && typeof updater === 'object' ? updater : {}) };
      return { dashboardSystemSummary: next };
    }),

  /** Jobs Manager page — filters, expanded details, selection; persists across SPA tab switches (survives unmount) */
  jobsPageSession: {
    expandedJobs: [],
    expandedDetailsJobs: [],
    testCasesView: null,
    testCasesFilter: 'all',
    testCasesSearch: '',
    selectedJobIds: [],
    jobsSearch: '',
    jobsStatusFilter: 'all',
    jobsTagFilter: '',
    jobsTagColorFilter: '', // '' = all palette colors
    jobsTimeFilter: 'all',
    editingTag: null,
    tagInput: '',
  },
  setJobsPageSession: (updater) =>
    set((state) => {
      const prev = state.jobsPageSession;
      const next =
        typeof updater === 'function'
          ? updater(prev)
          : { ...prev, ...(updater && typeof updater === 'object' ? updater : {}) };
      return { jobsPageSession: next };
    }),

  // When Library sends selected test cases to Run Set page (right panel)
  runSetImportContext: null, // { items: TestCase[], name?: string } | null
  setRunSetImportContext: (payload) => set({ runSetImportContext: payload }),
  clearRunSetImportContext: () => set({ runSetImportContext: null }),

  // File → Test Case builder draft (selected file ids)
  fileToTestCaseDraft: null, // { fileIds: string[], createdAt: string } | null
  setFileToTestCaseDraft: (fileIds) => set({
    fileToTestCaseDraft: {
      fileIds: Array.isArray(fileIds) ? fileIds.filter(Boolean) : [],
      createdAt: new Date().toISOString(),
    },
  }),
  clearFileToTestCaseDraft: () => set({ fileToTestCaseDraft: null }),

  // File Library UI mode
  fileLibraryMode: 'create', // 'create' | 'edit'
  setFileLibraryMode: (mode) => set({ fileLibraryMode: mode === 'edit' ? 'edit' : 'create' }),

  // UI State
  theme: (() => {
    if (typeof window === 'undefined') return 'dark';
    try {
      const KEY = 'appThemeV2';
      const saved = localStorage.getItem(KEY);
      return saved === 'dark' || saved === 'light' ? saved : 'dark';
    } catch {
      return 'dark';
    }
  })(),
  fleetViewMode: 'grid', // 'grid' | 'list'
  fleetFilters: {
    status: null,
    model: null,
    firmware: null
  },
  selectedBoards: [],
  // Persisted board selection for Run Set / Create Batch (mode + boardIds); load/save to localStorage
  runBoardSelection: (() => loadRunBoardSelection())(),
  setRunBoardSelection: (payload) => {
    set((state) => {
      const next = typeof payload === 'function' ? payload(state.runBoardSelection) : payload;
      const data = {
        mode: next?.mode === 'manual' ? 'manual' : 'auto',
        boardIds: Array.isArray(next?.boardIds) ? next.boardIds : (state.runBoardSelection?.boardIds ?? []),
      };
      saveRunBoardSelection(data);
      return { runBoardSelection: data };
    });
  },
  selectedJobFilter: 'all', // 'all' | 'my'
  loading: {
    systemHealth: false,
    boards: false,
    jobs: false,
    notifications: false,
    files: false,
  },
  errors: {
    systemHealth: null,
    boards: null,
    jobs: null,
    notifications: null,
    files: null,
  },
  toasts: [],
  /** In-app job alert (modal-style); also drives browser Notification when permitted */
  jobAttentionBanner: null,
  showJobAttentionBanner: (payload) => {
    if (jobAttentionBannerTimer) {
      clearTimeout(jobAttentionBannerTimer);
      jobAttentionBannerTimer = null;
    }
    const durationMs = payload?.durationMs ?? 5000 + Math.floor(Math.random() * 5001);
    const t = payload?.type === 'error' ? 'error' : payload?.type === 'success' ? 'success' : 'info';
    set({
      jobAttentionBanner: {
        title: payload?.title || 'Job update',
        message: payload?.message || '',
        type: t,
        jobId: payload?.jobId ?? null,
      },
    });
    try {
      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
        // eslint-disable-next-line no-new
        new Notification(payload?.title || 'Job update', { body: payload?.message || '' });
      }
    } catch (e) {
      /* ignore */
    }
    jobAttentionBannerTimer = setTimeout(() => {
      get().dismissJobAttentionBanner();
      jobAttentionBannerTimer = null;
    }, durationMs);
  },
  dismissJobAttentionBanner: () => {
    if (jobAttentionBannerTimer) {
      clearTimeout(jobAttentionBannerTimer);
      jobAttentionBannerTimer = null;
    }
    set({ jobAttentionBanner: null });
  },
  requestBrowserNotificationPermission: async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
    return Notification.requestPermission();
  },
  addToast: (toast) => {
    const id = toast?.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const entry = {
      id,
      type: 'info',
      message: '',
      duration: 4000,
      ...toast,
    };
    set((state) => ({ toasts: [...state.toasts, entry] }));
    if (entry.duration !== 0) {
      setTimeout(() => {
        get().removeToast(id);
      }, entry.duration);
    }
    return id;
  },
  removeToast: (id) => set((state) => ({ toasts: state.toasts.filter(t => t.id !== id) })),
  setTheme: (theme) => {
    const next = theme === 'dark' ? 'dark' : 'light';
    set({ theme: next });
    try {
      localStorage.setItem('appThemeV2', next);
    } catch (e) {
      console.error('Failed to persist theme', e);
    }
  },
  toggleTheme: () => {
    set((state) => {
      const next = state.theme === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem('appThemeV2', next);
      } catch (e) {
        console.error('Failed to persist theme', e);
      }
      return { theme: next };
    });
  },
  
  // Actions
  addVcd: (file) => set((state) => ({ vcdFiles: [...state.vcdFiles, file] })),
  addVcdFile: (file) => set((state) => ({ vcdFiles: [...state.vcdFiles, file] })),
  addFirmwareFile: (file) => set((state) => ({ firmwareFiles: [...state.firmwareFiles, file] })),
  setFileTag: async (fileId, tag) => {
    if (!fileId) return false;
    if (!beginFilePending(fileId, 'tags')) return false;
    try {
      const value = (tag || '').trim();
      const state = get();
      const payload = { tags: value };
      const col = state.fileTagColors?.[fileId];
      if (col) payload.tagColor = col;

      // Optimistic update so tags disappear immediately (no flicker / snap-back)
      let prevSnapshot = null;
      set((s) => {
        const current = s.fileTags || {};
        prevSnapshot = { ...current };
        const next = { ...current };
        if (!value) delete next[fileId];
        else next[fileId] = value;
        saveFileTags(next);
        return { fileTags: next };
      });

      try {
        await api.patchFileLibraryTags(fileId, payload);
        const ts = new Date().toISOString();
        set((s) => {
          const bump = (arr) =>
            Array.isArray(arr)
              ? arr.map((f) => (f && f.id === fileId ? { ...f, updatedAt: ts } : f))
              : arr;
          return {
            uploadedFiles: bump(s.uploadedFiles),
            vcdFiles: bump(s.vcdFiles),
            firmwareFiles: bump(s.firmwareFiles),
          };
        });
        return true;
      } catch (e) {
        console.error('Failed to save file tags', e);
        if (prevSnapshot) {
          set({ fileTags: prevSnapshot });
          saveFileTags(prevSnapshot);
        }
        return false;
      }
    } finally {
      endFilePending(fileId);
    }
  },
  setFileTagColor: async (fileId, colorKey) => {
    if (!fileId) return false;
    if (!beginFilePending(fileId, 'tags')) return false;
    try {
      const k = String(colorKey || '').trim();
      const normalized = isValidPaletteKey(k) ? k : null;
      const tags = (get().fileTags || {})[fileId] || '';
      const prevSnapshot = { ...(get().fileTagColors || {}) };
      set((s) => {
        const next = { ...(s.fileTagColors || {}) };
        if (!normalized) delete next[fileId];
        else next[fileId] = normalized;
        saveFileTagColors(next);
        return { fileTagColors: next };
      });
      try {
        await api.patchFileLibraryTags(fileId, {
          tags,
          tagColor: normalized || '',
        });
        const ts = new Date().toISOString();
        set((s) => {
          const bump = (arr) =>
            Array.isArray(arr)
              ? arr.map((f) => (f && f.id === fileId ? { ...f, updatedAt: ts } : f))
              : arr;
          return {
            uploadedFiles: bump(s.uploadedFiles),
            vcdFiles: bump(s.vcdFiles),
            firmwareFiles: bump(s.firmwareFiles),
          };
        });
        return true;
      } catch (e) {
        console.error('Failed to save file tag color', e);
        set(() => {
          saveFileTagColors(prevSnapshot);
          return { fileTagColors: prevSnapshot };
        });
        return false;
      }
    } finally {
      endFilePending(fileId);
    }
  },
  setFileDisplayName: (fileId, name) => {
    set((state) => {
      const next = { ...(state.fileDisplayNames || {}) };
      const value = (name || '').trim();
      if (!fileId) return {};
      if (!value) delete next[fileId];
      else next[fileId] = value;
      saveFileDisplayNames(next);
      return { fileDisplayNames: next };
    });
  },
  setBoardQueuePaused: (boardId, queuePaused) => {
    if (!boardId) return;
    set((state) => {
      const nextMap = {
        ...(state.boardQueuePaused || {}),
        [boardId]: !!queuePaused,
      };
      return {
        boardQueuePaused: nextMap,
        boards: (state.boards || []).map((b) =>
          b.id === boardId ? { ...b, queuePaused: !!queuePaused } : b
        ),
      };
    });
  },
  addBoard: async (boardInput) => {
    try {
      const payload = {
        name: boardInput.name,
        status: boardInput.status,
        ip: boardInput.ip,
        mac: boardInput.mac,
        firmware: boardInput.firmware,
        model: boardInput.model,
        tag: boardInput.tag,
        connections: boardInput.connections,
      };
      const created = await api.createBoard(payload);
      await get().refreshBoards();
      return created;
    } catch (error) {
      console.error('Failed to add board', error);
      return null;
    }
  },
  deleteBoard: async (boardId) => {
    set((state) => ({
      boards: state.boards.filter(b => b.id !== boardId),
      selectedBoards: state.selectedBoards.filter(id => id !== boardId),
    }));
    try {
      await api.deleteBoard(boardId);
      await get().refreshBoards();
      return true;
    } catch (error) {
      console.error('Failed to delete board', error);
      await get().refreshBoards();
      return false;
    }
  },
  deleteBoards: async (boardIds) => {
    set((state) => ({
      boards: state.boards.filter(b => !boardIds.includes(b.id)),
      selectedBoards: state.selectedBoards.filter(id => !boardIds.includes(id)),
    }));
    try {
      await api.batchBoardActions(boardIds, 'delete');
      await get().refreshBoards();
      return true;
    } catch (error) {
      console.error('Failed to delete boards', error);
      await get().refreshBoards();
      return false;
    }
  },
  updateBoard: async (boardId, updates) => {
    set((state) => ({
      boards: state.boards.map(b => b.id === boardId ? { ...b, ...updates } : b)
    }));
    try {
      const updated = await api.updateBoard(boardId, updates);
      if (updated) {
        set((state) => ({
          boards: state.boards.map(b => b.id === boardId ? updated : b)
        }));
      }
      return updated;
    } catch (error) {
      console.error('Failed to update board', error);
      await get().refreshBoards();
      return null;
    }
  },
  updateBoardTag: (boardId, tag) => {
    void get().updateBoard(boardId, { tag });
  },
  updateBoardConnections: (boardId, connections) => {
    void get().updateBoard(boardId, { connections });
  },
  addUploadedFile: async (file) => {
    const state = get();
    const existingNames = state.uploadedFiles.map(f => f.name);
    let finalName = file.name;
    let counter = 1;
    const extension = file.name.split('.').pop();
    const baseName = file.name.replace(`.${extension}`, '');
    
    while (existingNames.includes(finalName)) {
      finalName = `${baseName}_${counter}.${extension}`;
      counter++;
    }

    let uploadTarget = file;
    if (finalName !== file.name) {
      uploadTarget = new File([file], finalName, { type: file.type });
    }

    try {
      const ownerId = state.activeProfileId || getClientId();
      const ownerDisplayName = getActiveProfileDisplayNameForSnapshot(get);
      const meta = (typeof file === 'object' && file?.metadata ? file.metadata : {}) || {};
      const uploaded = await api.uploadFile(uploadTarget, {
        ...meta,
        owner_id: ownerId,
        owner_display_name: ownerDisplayName,
        visibility: meta.visibility || 'public',
      });
      const apName = state.profiles?.find((p) => p.id === state.activeProfileId)?.name;
      if (apName) rememberClientOwnerLabel(getClientId(), apName);
      if (uploaded.duplicateByContent) {
        get().addToast({ type: 'info', message: `"${uploaded.name}" has the same content as an existing file — reusing existing file` });
      }
      if (uploaded.duplicateByName && !uploaded.duplicateByContent) {
        get().addToast({ type: 'info', message: `Another file named "${uploaded.name}" already exists in the library` });
      }
      const mapped = {
        id: uploaded.id,
        name: uploaded.name,
        originalName: file.name,
        size: uploaded.size ?? file.size,
        sizeFormatted: formatFileSize(uploaded.size ?? file.size),
        date: uploaded.uploadDate || 'Just now',
        type: inferFileType(uploaded.name, uploaded.type),
        file: null,
        uploadDate: uploaded.uploadDate,
        updatedAt: uploaded.updatedAt || uploaded.uploadDate,
        ownerId: uploaded.ownerId ?? null,
        ownerName: uploaded.ownerName ?? uploaded.owner_name ?? null,
        visibility: uploaded.visibility || 'public',
        tags: uploaded.tags,
        tagColor: uploaded.tagColor,
      };
      syncOwnerLabelsFromFiles([mapped]);
      set((prev) => {
        const alreadyInList = prev.uploadedFiles.some((f) => f.id === uploaded.id);
        const nextFiles = alreadyInList ? prev.uploadedFiles : [...prev.uploadedFiles, mapped];
        const isVcd = inferFileType(mapped.name, mapped.type) === 'vcd';
        const nextVcd = !alreadyInList && isVcd ? [...prev.vcdFiles, mapped] : prev.vcdFiles;
        const nextFw = !alreadyInList && !isVcd ? [...prev.firmwareFiles, mapped] : prev.firmwareFiles;
        const nextTags = { ...(prev.fileTags || {}) };
        if (uploaded.tags !== undefined) {
          nextTags[mapped.id] =
            uploaded.tags != null && String(uploaded.tags).trim() !== '' ? String(uploaded.tags) : '';
        }
        const nextColors = { ...(prev.fileTagColors || {}) };
        if (uploaded.tagColor != null && String(uploaded.tagColor).trim() !== '') {
          nextColors[mapped.id] = String(uploaded.tagColor).trim();
        }
        saveFileTags(nextTags);
        saveFileTagColors(nextColors);
        return {
          uploadedFiles: nextFiles,
          vcdFiles: nextVcd,
          firmwareFiles: nextFw,
          fileTags: nextTags,
          fileTagColors: nextColors,
        };
      });
      return uploaded;
    } catch (error) {
      console.error('Failed to upload file', error);
      const msg = error?.message || String(error) || 'Unknown error';
      try {
        get().addToast?.({ type: 'error', message: `Upload failed: ${msg}` });
      } catch { /* addToast not ready */ }
      return null;
    }
  },
  removeUploadedFile: async (id) => {
    if (!beginFilePending(id, 'delete')) return false;
    try {
      const stateBefore = get();
      const target = (stateBefore.uploadedFiles || []).find((f) => f.id === id);
      const targetName = target?.name || null;

      await api.deleteFile(id);

      set((state) => {
        const nextTags = { ...(state.fileTags || {}) };
        delete nextTags[id];
        const nextColors = { ...(state.fileTagColors || {}) };
        delete nextColors[id];
        saveFileTags(nextTags);
        saveFileTagColors(nextColors);
        const next = {
          uploadedFiles: state.uploadedFiles.filter(f => f.id !== id),
          vcdFiles: state.vcdFiles.filter(f => f.id !== id),
          firmwareFiles: state.firmwareFiles.filter(f => f.id !== id),
          fileTags: nextTags,
          fileTagColors: nextColors,
        };

        if (targetName) {
          const clearTcFileRefs = (tc) => {
            let changed = false;
            const updated = { ...tc };
            if (updated.vcdName === targetName) { updated.vcdName = ''; changed = true; }
            if (updated.binName === targetName) { updated.binName = ''; changed = true; }
            if (updated.linName === targetName) { updated.linName = ''; changed = true; }
            if (Array.isArray(updated.commands) && updated.commands.length > 0) {
              const nextCmds = updated.commands.filter((c) => c && c.file !== targetName);
              if (nextCmds.length !== updated.commands.length) {
                updated.commands = nextCmds;
                changed = true;
              }
            }
            if (updated.extraColumns && typeof updated.extraColumns === 'object') {
              const extra = { ...updated.extraColumns };
              let extraChanged = false;
              Object.keys(extra).forEach((k) => {
                if (extra[k] === targetName) {
                  extra[k] = '';
                  extraChanged = true;
                }
              });
              if (extraChanged) {
                updated.extraColumns = extra;
                changed = true;
              }
            }
            return changed ? updated : tc;
          };

          const cleanedSaved = (state.savedTestCases || []).map(clearTcFileRefs);
          const cleanedSets = (state.savedTestCaseSets || []).map((set) => ({
            ...set,
            items: Array.isArray(set.items) ? set.items.map(clearTcFileRefs) : set.items,
          }));

          saveSavedTestCases(cleanedSaved);
          saveSavedTestCaseSets(cleanedSets);

          next.savedTestCases = cleanedSaved;
          next.savedTestCaseSets = cleanedSets;
        }

        return next;
      });
      return true;
    } catch (error) {
      if (error?.status === 404) {
        get().addToast({ type: 'info', message: 'File was already removed.' });
        void get().refreshFiles();
      } else if (error?.status === 409) {
        get().addToast({
          type: 'warning',
          message: error?.detail || 'File is in use by a running or pending set. Wait for the set to finish or remove the set first.',
        });
      } else {
        console.error('Failed to delete file', error);
        get().addToast({ type: 'error', message: 'Failed to delete file.' });
      }
      return false;
    } finally {
      endFilePending(id);
    }
  },

  // Saved Test Cases (library)
  getAllGlobalTestCaseNames: (excludeId, options = {}) => {
    const extra = options.extraTestCaseLists || [];
    return buildGlobalTestCaseNameSet(get(), excludeId, extra);
  },
  ensureUniqueTestCaseName: (desired, excludeId, options = {}) => {
    const used = buildGlobalTestCaseNameSet(get(), excludeId, options.extraTestCaseLists || []);
    return pickUniqueTestCaseName(desired, used);
  },
  addSavedTestCase: (tc, options = {}) => {
    const extraLists = options.extraTestCaseLists || [];
    const state = get();
    const used = buildGlobalTestCaseNameSet(state, null, extraLists);
    const rawDesired = normalizeTestCaseName(tc.name);
    const finalName = pickUniqueTestCaseName(rawDesired || 'Test case', used);
    if (rawDesired && finalName !== rawDesired) {
      get().addToast({
        type: 'info',
        message: `Name "${rawDesired}" already exists — renamed to "${finalName}"`,
      });
    }
    const id = `tc-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const ts = testCaseNowIso();
    const entry = {
      ...tc,
      id,
      name: finalName,
      createdAt: tc.createdAt || ts,
      updatedAt: tc.updatedAt || ts,
    };

    // Prevent saving an identical TC (same full file-set) more than once (current profile + global snapshot when available).
    const entryKey = getTestCaseFilesKey(entry);
    if (entryKey) {
      const localList = Array.isArray(state.savedTestCases) ? state.savedTestCases : [];
      const globalList =
        state.globalTestCaseDataLoaded && Array.isArray(state.globalSavedTestCases)
          ? state.globalSavedTestCases
          : [];
      const existing =
        localList.find((t) => getTestCaseFilesKey(t) === entryKey) ||
        globalList.find((t) => getTestCaseFilesKey(t) === entryKey);
      if (existing) {
        queueMicrotask(() => {
          get().addToast({
            type: 'warning',
            message: `This test case matches an existing one (same VCD/ERoM/ULP/MDI files). Please change the files before saving.`,
          });
        });
        return String(existing.id || '');
      }
    }

    set((state) => {
      if (state.loadedSetId) {
        const table = [...(state.loadedSetTable || [])];
        if (typeof options.insertAt === 'number') {
          const at = Math.max(0, Math.min(options.insertAt, table.length));
          table.splice(at, 0, entry);
          return { loadedSetTable: table };
        }
        return { loadedSetTable: [...table, entry] };
      }
      const next = [...state.savedTestCases];
      if (typeof options.insertAt === 'number') {
        const at = Math.max(0, Math.min(options.insertAt, next.length));
        next.splice(at, 0, entry);
      } else {
        next.push(entry);
      }
      saveSavedTestCases(next);
      return { savedTestCases: next };
    });
    return id;
  },
  updateSavedTestCase: (id, updates) => {
    let blocked = false;
    set((state) => {
    if (updates.name !== undefined) {
      const newName = normalizeTestCaseName(updates.name);
      if (newName) {
        const used = buildGlobalTestCaseNameSet(state, id, []);
        if (used.has(newName)) {
          queueMicrotask(() => {
            get().addToast({
              type: 'warning',
              message: 'That name already exists (across all profiles). Please use a different name.',
            });
          });
          blocked = true;
          return state;
        }
      }
    }
    const idStr = id == null ? '' : String(id);
    const matchId = (t) => String(t.id) === idStr;
    const patch = { ...updates, updatedAt: testCaseNowIso() };
    // Prevent editing a TC into a duplicate of another TC (same full file-set),
    // regardless of whether it's in savedTestCases or loadedSetTable.
    try {
      const current =
        (Array.isArray(state.savedTestCases) ? state.savedTestCases : []).find(matchId) ||
        (Array.isArray(state.loadedSetTable) ? state.loadedSetTable : []).find(matchId) ||
        null;
      const candidate = current ? { ...current, ...patch } : patch;
      const candKey = getTestCaseFilesKey(candidate);
      if (candKey) {
        const localList = Array.isArray(state.savedTestCases) ? state.savedTestCases : [];
        const globalList =
          state.globalTestCaseDataLoaded && Array.isArray(state.globalSavedTestCases)
            ? state.globalSavedTestCases
            : [];
        const setList = Array.isArray(state.loadedSetTable) ? state.loadedSetTable : [];
        const dup =
          localList.find((t) => String(t.id) !== idStr && getTestCaseFilesKey(t) === candKey) ||
          globalList.find((t) => String(t.id) !== idStr && getTestCaseFilesKey(t) === candKey) ||
          setList.find((t) => String(t.id) !== idStr && getTestCaseFilesKey(t) === candKey);
        if (dup) {
          queueMicrotask(() => {
            get().addToast({
              type: 'warning',
              message: `Cannot save changes — files match existing test case "${String(dup?.name || dup?.id || '').trim()}". Please change files.`,
            });
          });
          blocked = true;
          return state;
        }
      }
    } catch {
      // ignore and allow update
    }

    // Library / File Library แก้ saved test case ต้องอัปเดต savedTestCases เสมอ — แม้จะมี loadedSetId จากหน้า Create Test Case อยู่
    const inSaved = (state.savedTestCases || []).some(matchId);
    if (inSaved) {
      const next = state.savedTestCases.map((t) => (matchId(t) ? { ...t, ...patch } : t));
      saveSavedTestCases(next);
      return { savedTestCases: next };
    }
    if (state.loadedSetId) {
      const next = (state.loadedSetTable || []).map((t) => (matchId(t) ? { ...t, ...patch } : t));
      return { loadedSetTable: next };
    }
    const next = state.savedTestCases.map((t) => (matchId(t) ? { ...t, ...patch } : t));
    saveSavedTestCases(next);
    return { savedTestCases: next };
    });
    return !blocked;
  },
  removeSavedTestCase: (id) => {
    if (id == null || id === '') return;
    if (!beginTestCasePending(id, 'delete')) return;
    try {
      set((state) => {
        const idStr = id == null ? '' : String(id);
        const matchId = (t) => String(t.id) === idStr;
        // ถ้ากำลังแก้ไข Set อยู่ ให้ลบเฉพาะจาก table ชั่วคราวของ Set นั้น
        if (state.loadedSetId) {
          const next = (state.loadedSetTable || []).filter((t) => !matchId(t));
          return { loadedSetTable: next };
        }

        const target = (state.savedTestCases || []).find((t) => matchId(t));
        const nextCases = (state.savedTestCases || []).filter((t) => !matchId(t));

        // ลบ test case ที่มี content ตรงกันออกจากทุก Saved Set ด้วย
        let nextSets = state.savedTestCaseSets || [];
        if (target) {
          const sameContent = (item) =>
            (item.name || '').trim() === (target.name || '').trim() &&
            (item.vcdName || '').trim() === (target.vcdName || '').trim() &&
            (item.binName || '').trim() === (target.binName || '').trim() &&
            (item.linName || '').trim() === (target.linName || '').trim();

          nextSets = (state.savedTestCaseSets || [])
            .map((set) => ({
              ...set,
              items: Array.isArray(set.items) ? set.items.filter((item) => !sameContent(item)) : set.items,
            }))
            // ถ้า source ใน set ถูกลบจนไม่เหลือ test case แล้ว ให้ลบ set นั้นออกเลย
            .filter((set) => Array.isArray(set.items) && set.items.length > 0);
          saveSavedTestCaseSets(nextSets);
        }

        saveSavedTestCases(nextCases);
        return { savedTestCases: nextCases, savedTestCaseSets: nextSets };
      });
    } finally {
      queueMicrotask(() => endTestCasePending(id));
    }
  },
  moveSavedTestCaseUp: (id) => {
    const stateBefore = get();
    const list = stateBefore.loadedSetId ? (stateBefore.loadedSetTable || []) : stateBefore.savedTestCases;
    const i = list.findIndex((t) => t.id === id);
    if (i <= 0) return;
    if (!beginTestCasePending(id, 'move')) return;
    try {
      set((state) => {
        const list2 = state.loadedSetId ? (state.loadedSetTable || []) : state.savedTestCases;
        const j = list2.findIndex((t) => t.id === id);
        if (j <= 0) return state;
        const now = testCaseNowIso();
        const next = [...list2];
        [next[j - 1], next[j]] = [next[j], next[j - 1]];
        next[j - 1] = { ...next[j - 1], updatedAt: now };
        next[j] = { ...next[j], updatedAt: now };
        if (state.loadedSetId) return { loadedSetTable: next };
        saveSavedTestCases(next);
        return { savedTestCases: next };
      });
    } finally {
      queueMicrotask(() => endTestCasePending(id));
    }
  },
  moveSavedTestCaseDown: (id) => {
    const stateBefore = get();
    const list = stateBefore.loadedSetId ? (stateBefore.loadedSetTable || []) : stateBefore.savedTestCases;
    const i = list.findIndex((t) => t.id === id);
    if (i < 0 || i >= list.length - 1) return;
    if (!beginTestCasePending(id, 'move')) return;
    try {
      set((state) => {
        const list2 = state.loadedSetId ? (state.loadedSetTable || []) : state.savedTestCases;
        const j = list2.findIndex((t) => t.id === id);
        if (j < 0 || j >= list2.length - 1) return state;
        const now = testCaseNowIso();
        const next = [...list2];
        [next[j], next[j + 1]] = [next[j + 1], next[j]];
        next[j] = { ...next[j], updatedAt: now };
        next[j + 1] = { ...next[j + 1], updatedAt: now };
        if (state.loadedSetId) return { loadedSetTable: next };
        saveSavedTestCases(next);
        return { savedTestCases: next };
      });
    } finally {
      queueMicrotask(() => endTestCasePending(id));
    }
  },
  reorderSavedTestCases: (fromIndex, toIndex) => {
    const stateBefore = get();
    const list = stateBefore.loadedSetId ? (stateBefore.loadedSetTable || []) : stateBefore.savedTestCases;
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= list.length || toIndex >= list.length) return;
    const movedItem = list[fromIndex];
    const id = movedItem?.id;
    if (!id || !beginTestCasePending(id, 'move')) return;
    try {
      set((state) => {
        const list2 = state.loadedSetId ? (state.loadedSetTable || []) : state.savedTestCases;
        const arr = [...list2];
        if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= arr.length || toIndex >= arr.length) return state;
        const [item] = arr.splice(fromIndex, 1);
        const insertAt = fromIndex < toIndex ? toIndex - 1 : toIndex;
        arr.splice(insertAt, 0, item);
        const ts = testCaseNowIso();
        const arrBumped = arr.map((t) => (t.id === item.id ? { ...t, updatedAt: ts } : t));
        if (state.loadedSetId) return { loadedSetTable: arrBumped };
        saveSavedTestCases(arrBumped);
        return { savedTestCases: arrBumped };
      });
    } finally {
      queueMicrotask(() => endTestCasePending(id));
    }
  },
  duplicateSavedTestCase: (id, overrides = {}) => {
    const stateBefore = get();
    const list = stateBefore.loadedSetId ? (stateBefore.loadedSetTable || []) : stateBefore.savedTestCases;
    const tc0 = list.find((t) => t.id === id);
    if (!tc0) return;
    if (!beginTestCasePending(id, 'duplicate')) return;
    try {
      set((state) => {
        const list2 = state.loadedSetId ? (state.loadedSetTable || []) : state.savedTestCases;
        const tc = list2.find((t) => t.id === id);
        if (!tc) return state;
        const newId = `tc-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        const commands = (Array.isArray(tc.commands) ? tc.commands : []).map((c, i) => ({
          ...c,
          id: `cmd-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 9)}`,
        }));
        const used = buildGlobalTestCaseNameSet(state, null, []);
        const baseName = normalizeTestCaseName(overrides.name != null ? overrides.name : tc.name) || 'Test case';
        const uniqueName = pickUniqueTestCaseName(baseName, used);
        if (uniqueName !== baseName) {
          queueMicrotask(() => {
            get().addToast({
              type: 'info',
              message: `ชื่อ "${baseName}" ถูกใช้แล้ว — ใช้ "${uniqueName}" สำหรับสำเนา`,
            });
          });
        }
        const tsDup = testCaseNowIso();
        const newTc = { ...tc, id: newId, commands, createdAt: tsDup, updatedAt: tsDup, ...overrides, name: uniqueName };
        const i = list2.findIndex((t) => t.id === id);
        const next = [...list2];
        next.splice(i + 1, 0, newTc);
        if (state.loadedSetId) return { loadedSetTable: next };
        saveSavedTestCases(next);
        return { savedTestCases: next };
      });
    } finally {
      queueMicrotask(() => endTestCasePending(id));
    }
  },
  setSavedTestCases: (list) => set((state) => {
    const next = Array.isArray(list) ? list : [];
    if (state.loadedSetId) return { loadedSetTable: next };
    saveSavedTestCases(next);
    return { savedTestCases: next };
  }),

  // Working Test Cases (draft) — table only; save to library explicitly
  addWorkingTestCase: (tc) => {
    const id = `tc-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const entry = { ...tc, id, createdAt: tc.createdAt || new Date().toISOString() };
    set((state) => ({ workingTestCases: [...state.workingTestCases, entry] }));
    return id;
  },
  updateWorkingTestCase: (id, updates) => set((state) => ({
    workingTestCases: state.workingTestCases.map((t) => (t.id === id ? { ...t, ...updates } : t)),
  })),
  removeWorkingTestCase: (id) => set((state) => ({
    workingTestCases: state.workingTestCases.filter((t) => t.id !== id),
  })),
  setWorkingTestCases: (list) => set({ workingTestCases: Array.isArray(list) ? list : [] }),
  moveWorkingTestCaseUp: (id) => set((state) => {
    const list = state.workingTestCases;
    const i = list.findIndex((t) => t.id === id);
    if (i <= 0) return state;
    const next = [...list];
    [next[i - 1], next[i]] = [next[i], next[i - 1]];
    return { workingTestCases: next };
  }),
  moveWorkingTestCaseDown: (id) => set((state) => {
    const list = state.workingTestCases;
    const i = list.findIndex((t) => t.id === id);
    if (i < 0 || i >= list.length - 1) return state;
    const next = [...list];
    [next[i], next[i + 1]] = [next[i + 1], next[i]];
    return { workingTestCases: next };
  }),
  reorderWorkingTestCases: (fromIndex, toIndex) => set((state) => {
    const list = [...state.workingTestCases];
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= list.length || toIndex >= list.length) return state;
    const [item] = list.splice(fromIndex, 1);
    const insertAt = fromIndex < toIndex ? toIndex - 1 : toIndex;
    list.splice(insertAt, 0, item);
    return { workingTestCases: list };
  }),
  duplicateWorkingTestCase: (id, overrides = {}) => set((state) => {
    const tc = state.workingTestCases.find((t) => t.id === id);
    if (!tc) return state;
    const newId = `tc-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const commands = (Array.isArray(tc.commands) ? tc.commands : []).map((c, i) => ({
      ...c,
      id: `cmd-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 9)}`,
    }));
    const newTc = { ...tc, id: newId, commands, createdAt: new Date().toISOString(), ...overrides };
    const i = state.workingTestCases.findIndex((t) => t.id === id);
    const next = [...state.workingTestCases];
    next.splice(i + 1, 0, newTc);
    return { workingTestCases: next };
  }),
  bulkUpdateWorkingTryCount: (ids, tryCount) => set((state) => {
    const num = Math.max(1, Math.min(100, parseInt(tryCount, 10) || 1));
    return {
      workingTestCases: state.workingTestCases.map((t) => (ids.includes(t.id) ? { ...t, tryCount: num } : t)),
    };
  }),
  addWorkingTestCaseCommand: (tcId, { type, file = '' }) => set((state) => {
    const tc = state.workingTestCases.find((t) => t.id === tcId);
    if (!tc) return state;
    const commands = Array.isArray(tc.commands) ? tc.commands : [];
    const id = `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    return {
      workingTestCases: state.workingTestCases.map((t) =>
        t.id === tcId ? { ...t, commands: [...commands, { id, type, file }] } : t
      ),
    };
  }),
  updateWorkingTestCaseCommand: (tcId, cmdId, updates) => set((state) => ({
    workingTestCases: state.workingTestCases.map((t) => {
      if (t.id !== tcId || !Array.isArray(t.commands)) return t;
      return {
        ...t,
        commands: t.commands.map((c) => (c.id === cmdId ? { ...c, ...updates } : c)),
      };
    }),
  })),
  removeWorkingTestCaseCommand: (tcId, cmdId) => set((state) => ({
    workingTestCases: state.workingTestCases.map((t) => {
      if (t.id !== tcId || !Array.isArray(t.commands)) return t;
      return { ...t, commands: t.commands.filter((c) => c.id !== cmdId) };
    }),
  })),
  saveWorkingToLibrary: () => {
    const state = get();
    const list = state.workingTestCases || [];
    saveSavedTestCases(list);
    set({ savedTestCases: list });
    if (isBackendProfileId(getActiveProfileId())) {
      const p = loadProfile(getActiveProfileId());
      void api.putProfileData(getActiveProfileId(), { savedTestCases: list, savedTestCaseSets: p?.savedTestCaseSets ?? [] }).catch((err) => {
        console.error('[putProfileData failed: saveWorkingToLibrary]', err);
        try { get().addToast?.({ type: 'error', message: `Save to server failed: ${err?.message || err}` }); } catch { /* ignore */ }
      });
    }
  },

  bulkUpdateTryCount: (ids, tryCount) => set((state) => {
    const num = Math.max(1, Math.min(100, parseInt(tryCount, 10) || 1));
    const list = state.loadedSetId ? (state.loadedSetTable || []) : state.savedTestCases;
    const now = testCaseNowIso();
    const next = list.map((t) => (ids.includes(t.id) ? { ...t, tryCount: num, updatedAt: now } : t));
    if (state.loadedSetId) return { loadedSetTable: next };
    saveSavedTestCases(next);
    return { savedTestCases: next };
  }),

  // Commands/sequences per test case: [{ id, type: 'mdi'|'vcd'|'erom'|'ulp', file: string }]
  addTestCaseCommand: (tcId, { type, file = '' }) => set((state) => {
    const list = state.loadedSetId ? (state.loadedSetTable || []) : state.savedTestCases;
    const tc = list.find((t) => t.id === tcId);
    if (!tc) return state;
    const commands = Array.isArray(tc.commands) ? tc.commands : [];
    const id = `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const now = testCaseNowIso();
    const next = list.map((t) =>
      t.id === tcId ? { ...t, updatedAt: now, commands: [...commands, { id, type, file }] } : t
    );
    if (state.loadedSetId) return { loadedSetTable: next };
    saveSavedTestCases(next);
    return { savedTestCases: next };
  }),
  updateTestCaseCommand: (tcId, cmdId, updates) => set((state) => {
    const list = state.loadedSetId ? (state.loadedSetTable || []) : state.savedTestCases;
    const now = testCaseNowIso();
    const next = list.map((t) => {
      if (t.id !== tcId || !Array.isArray(t.commands)) return t;
      return {
        ...t,
        updatedAt: now,
        commands: t.commands.map((c) => (c.id === cmdId ? { ...c, ...updates } : c)),
      };
    });
    if (state.loadedSetId) return { loadedSetTable: next };
    saveSavedTestCases(next);
    return { savedTestCases: next };
  }),
  removeTestCaseCommand: (tcId, cmdId) => set((state) => {
    const list = state.loadedSetId ? (state.loadedSetTable || []) : state.savedTestCases;
    const now = testCaseNowIso();
    const next = list.map((t) => {
      if (t.id !== tcId || !Array.isArray(t.commands)) return t;
      return { ...t, updatedAt: now, commands: t.commands.filter((c) => c.id !== cmdId) };
    });
    if (state.loadedSetId) return { loadedSetTable: next };
    saveSavedTestCases(next);
    return { savedTestCases: next };
  }),

  // Saved Test Case Sets (collections) — เก็บ items + fileLibrarySnapshot (รายชื่อไฟล์ที่ Set ใช้)
  addSavedTestCaseSet: (name, items, options = {}) => {
    const id = `tcs-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    if (!beginSavedTestCaseSetPending(id, 'add')) return;
    try {
      set((state) => {
        const now = new Date().toISOString();
        const usedInSet = new Set();
        let renamedInSet = false;
        const normalizedItems = (items || []).map((t, idx) => {
          const itemId = t.id || `tc-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 9)}`;
          const base = normalizeTestCaseName(t.name) || `Test case ${idx + 1}`;
          const finalName = pickUniqueTestCaseName(base, usedInSet);
          if (finalName !== base) renamedInSet = true;
          usedInSet.add(finalName);
          return {
            id: itemId,
            name: finalName,
            vcdName: t.vcdName || '',
            binName: t.binName || '',
            linName: t.linName || '',
            boardId: t.boardId || '',
            tryCount: typeof t.tryCount === 'number' && t.tryCount > 0 ? t.tryCount : 1,
            extraColumns: t.extraColumns && typeof t.extraColumns === 'object' ? { ...t.extraColumns } : {},
            createdAt: t.createdAt || now,
          };
        });
        if (renamedInSet) {
          get().addToast({ type: 'info', message: 'พบชื่อซ้ำใน set เดียวกัน — ปรับชื่ออัตโนมัติใน set นี้เท่านั้น' });
        }
        const fileLibrarySnapshot = options.fileLibrarySnapshot || [];
        const entry = { id, name: name || 'Unnamed Set', createdAt: now, updatedAt: now, items: normalizedItems, fileLibrarySnapshot };
        const tagTrim = typeof options.tag === 'string' ? options.tag.trim() : '';
        if (tagTrim) {
          const colorKey = options.tagColor && TAG_PALETTE_MAP[options.tagColor] ? options.tagColor : 'mint';
          entry.tag = tagTrim;
          entry.tagColor = colorKey;
          const parts = splitTagsComma(tagTrim);
          if (parts.length > 0) {
            entry.tagColorList = parts.map(() => colorKey);
          }
        }
        const next = [...state.savedTestCaseSets, entry];
        saveSavedTestCaseSets(next);
        return { savedTestCaseSets: next };
      });
    } finally {
      queueMicrotask(() => endSavedTestCaseSetPending(id));
    }
  },
  updateSavedTestCaseSet: (id, updates) => set((state) => {
    if (updates.items) {
      const items = updates.items;
      const namesSeen = new Set();
      for (const tc of items) {
        const n = normalizeTestCaseName(tc.name);
        if (!n) continue;
        if (namesSeen.has(n)) {
          get().addToast({ type: 'warning', message: 'Test case name is duplicated in the same set — not saving' });
          return state;
        }
        namesSeen.add(n);
        const ex = tc.id;
        const used = buildGlobalTestCaseNameSet(state, ex, []);
        if (used.has(n)) {
          get().addToast({
            type: 'warning',
            message: `Name "${n}" is already in use in the system (other profiles or test cases)`,
          });
          return state;
        }
      }
    }
    const next = state.savedTestCaseSets.map((s) => (s.id === id ? { ...s, ...updates, updatedAt: new Date().toISOString() } : s));
    saveSavedTestCaseSets(next);
    return { savedTestCaseSets: next };
  }),
  /**
   * Append test cases to a saved set — validates **only new items** (not full re-validate of existing rows).
   * Needed when library TCs share the same display name as set copies (different ids); full updateSavedTestCaseSet would reject the merge.
   */
  appendToSavedTestCaseSet: (setId, newItems, options = {}) => {
    let ok = false;
    set((state) => {
      const sets = state.savedTestCaseSets || [];
      const idx = sets.findIndex((s) => s.id === setId);
      if (idx < 0) {
        get().addToast({ type: 'error', message: 'ไม่พบ set' });
        return state;
      }
      const list = newItems || [];
      if (!Array.isArray(list) || list.length === 0) {
        return state;
      }
      const cur = sets[idx];
      const baseItems = Array.isArray(cur.items) ? cur.items : [];
      const namesInSet = new Set(
        baseItems.map((t) => normalizeTestCaseName(t.name)).filter(Boolean),
      );
      for (const tc of list) {
        const n = normalizeTestCaseName(tc.name);
        if (!n) continue;
        if (namesInSet.has(n)) {
          get().addToast({ type: 'warning', message: 'Test case name is duplicated in the same set — not saving' });
          return state;
        }
        namesInSet.add(n);
        const ex = tc.id;
        const used = buildGlobalTestCaseNameSet(state, ex, []);
        subtractNamesFromSharedTestCaseSignature(used, tc, state);
        if (used.has(n)) {
          get().addToast({
            type: 'warning',
            message: `Name "${n}" is already in use in the system (other profiles or test cases)`,
          });
          return state;
        }
      }
      const mergedItems = [...baseItems, ...list];
      const fileLibrarySnapshot = options.fileLibrarySnapshot;
      const next = sets.map((s) =>
        s.id === setId
          ? {
              ...s,
              items: mergedItems,
              updatedAt: new Date().toISOString(),
              ...(fileLibrarySnapshot != null ? { fileLibrarySnapshot } : {}),
            }
          : s,
      );
      saveSavedTestCaseSets(next);
      ok = true;
      return { savedTestCaseSets: next };
    });
    return ok;
  },
  /** Remove rows from one set by original item indices — no global name re-validation (does not delete library TCs). */
  removeSavedTestCaseSetRows: (setId, indicesSet) => {
    let ok = false;
    set((state) => {
      const sets = state.savedTestCaseSets || [];
      const idx = sets.findIndex((s) => s.id === setId);
      if (idx < 0) {
        get().addToast({ type: 'error', message: 'ไม่พบ set' });
        return state;
      }
      const rm = indicesSet instanceof Set ? indicesSet : new Set(indicesSet || []);
      if (rm.size === 0) return state;
      const cur = sets[idx];
      const base = Array.isArray(cur.items) ? cur.items : [];
      const newItems = base.filter((_, i) => !rm.has(i));
      const allNames = new Set();
      newItems.forEach((tc) => {
        collectFileNamesFromTestCaseForSetSnapshot(tc).forEach((n) => allNames.add(n));
      });
      const fileLibrarySnapshot = [...allNames].map((n) => ({ name: n }));
      const next = sets.map((s) =>
        s.id === setId
          ? {
              ...s,
              items: newItems,
              fileLibrarySnapshot,
              updatedAt: new Date().toISOString(),
            }
          : s,
      );
      saveSavedTestCaseSets(next);
      ok = true;
      return { savedTestCaseSets: next };
    });
    return ok;
  },
  removeSavedTestCaseSet: (id) => {
    if (id == null || id === '') return;
    if (!beginSavedTestCaseSetPending(id, 'delete')) return;
    try {
      set((state) => {
        const next = state.savedTestCaseSets.filter((s) => s.id !== id);
        saveSavedTestCaseSets(next);
        return { savedTestCaseSets: next };
      });
    } finally {
      queueMicrotask(() => endSavedTestCaseSetPending(id));
    }
  },
  reorderSavedTestCaseSets: (fromIndex, toIndex) => {
    const list0 = get().savedTestCaseSets || [];
    if (fromIndex < 0 || fromIndex >= list0.length || toIndex < 0 || toIndex >= list0.length) return;
    const moved = list0[fromIndex];
    const sid = moved?.id;
    if (!sid || !beginSavedTestCaseSetPending(sid, 'move')) return;
    try {
      set((state) => {
        const list = [...state.savedTestCaseSets];
        if (fromIndex < 0 || fromIndex >= list.length || toIndex < 0 || toIndex >= list.length) return state;
        const [removed] = list.splice(fromIndex, 1);
        list.splice(toIndex, 0, removed);
        saveSavedTestCaseSets(list);
        return { savedTestCaseSets: list };
      });
    } finally {
      queueMicrotask(() => endSavedTestCaseSetPending(sid));
    }
  },
  moveSavedTestCaseSetUp: (id) => {
    const list0 = [...(get().savedTestCaseSets || [])];
    const idx = list0.findIndex((s) => s.id === id);
    if (idx <= 0) return;
    if (!beginSavedTestCaseSetPending(id, 'move')) return;
    try {
      set((state) => {
        const list = [...state.savedTestCaseSets];
        const j = list.findIndex((s) => s.id === id);
        if (j <= 0) return state;
        [list[j - 1], list[j]] = [list[j], list[j - 1]];
        saveSavedTestCaseSets(list);
        return { savedTestCaseSets: list };
      });
    } finally {
      queueMicrotask(() => endSavedTestCaseSetPending(id));
    }
  },
  moveSavedTestCaseSetDown: (id) => {
    const list0 = [...(get().savedTestCaseSets || [])];
    const idx = list0.findIndex((s) => s.id === id);
    if (idx < 0 || idx >= list0.length - 1) return;
    if (!beginSavedTestCaseSetPending(id, 'move')) return;
    try {
      set((state) => {
        const list = [...state.savedTestCaseSets];
        const j = list.findIndex((s) => s.id === id);
        if (j < 0 || j >= list.length - 1) return state;
        [list[j], list[j + 1]] = [list[j + 1], list[j]];
        saveSavedTestCaseSets(list);
        return { savedTestCaseSets: list };
      });
    } finally {
      queueMicrotask(() => endSavedTestCaseSetPending(id));
    }
  },
  duplicateSavedTestCaseSet: (id) => {
    const original = (get().savedTestCaseSets || []).find((s) => s.id === id);
    if (!original) return;
    if (!beginSavedTestCaseSetPending(id, 'duplicate')) return;
    try {
      set((state) => {
        const src = state.savedTestCaseSets.find((s) => s.id === id);
        if (!src) return state;
        const now = new Date().toISOString();
        const newId = `tcs-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        const baseName = src.name || 'Set';
        const newName = `${baseName} (copy)`;
        const copy = {
          ...src,
          id: newId,
          name: newName,
          createdAt: now,
          updatedAt: now,
        };
        const next = [...state.savedTestCaseSets, copy];
        saveSavedTestCaseSets(next);
        return { savedTestCaseSets: next };
      });
    } finally {
      queueMicrotask(() => endSavedTestCaseSetPending(id));
    }
  },
  applySavedTestCaseSet: (id) => {
    const exists = (get().savedTestCaseSets || []).some((s) => s.id === id);
    if (!exists) return;
    if (!beginSavedTestCaseSetPending(id, 'apply')) return;
    try {
      set((state) => {
        const setEntry = state.savedTestCaseSets.find((s) => s.id === id);
        if (!setEntry) return state;
        const used = buildGlobalTestCaseNameSet(state, null, []);
        const list = (setEntry.items || []).map((t) => {
          const base = normalizeTestCaseName(t.name) || 'Test case';
          const name = pickUniqueTestCaseName(base, used);
          used.add(name);
          const extra = t.extraColumns && typeof t.extraColumns === 'object' ? { ...t.extraColumns } : {};
          const commands = [];
          ['VCD2', 'VCD3', 'VCD4', 'ERoM2', 'ERoM3', 'ULP2', 'ULP3'].forEach((col) => {
            const v = (extra[col] ?? '').toString().trim();
            if (v) {
              const type = col.startsWith('VCD') ? 'vcd' : col.startsWith('ERoM') ? 'erom' : 'ulp';
              commands.push({ id: `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`, type, file: v });
              delete extra[col];
            }
          });
          return {
            id: `tc-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            name,
            vcdName: t.vcdName || '',
            binName: t.binName || '',
            linName: t.linName || '',
            boardId: t.boardId || '',
            tryCount: typeof t.tryCount === 'number' && t.tryCount > 0 ? t.tryCount : 1,
            extraColumns: extra,
            commands,
            createdAt: t.createdAt || new Date().toISOString(),
          };
        });
        saveSavedTestCases(list);
        return { savedTestCases: list, workingTestCases: [] };
      });
    } finally {
      queueMicrotask(() => endSavedTestCaseSetPending(id));
    }
  },
  /** Load set items into table for editing. Uses loadedSetTable only — savedTestCases (library) is NOT touched. */
  loadSetForEditing: (id) => set((state) => {
    const setEntry = state.savedTestCaseSets.find((s) => s.id === id);
    if (!setEntry) return state;
    const usedLocal = new Set();
    const list = (setEntry.items || []).map((t) => {
      const base = normalizeTestCaseName(t.name) || 'Test case';
      let name = base;
      if (usedLocal.has(name)) {
        name = pickUniqueTestCaseName(base, usedLocal);
      }
      usedLocal.add(name);
      const extra = t.extraColumns && typeof t.extraColumns === 'object' ? { ...t.extraColumns } : {};
      const commands = [];
      ['VCD2', 'VCD3', 'VCD4', 'ERoM2', 'ERoM3', 'ULP2', 'ULP3'].forEach((col) => {
        const v = (extra[col] ?? '').toString().trim();
        if (v) {
          const type = col.startsWith('VCD') ? 'vcd' : col.startsWith('ERoM') ? 'erom' : 'ulp';
          commands.push({ id: `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`, type, file: v });
          delete extra[col];
        }
      });
      return {
        id: `tc-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        name,
        vcdName: t.vcdName || '',
        binName: t.binName || '',
        linName: t.linName || '',
        boardId: t.boardId || '',
        tryCount: typeof t.tryCount === 'number' && t.tryCount > 0 ? t.tryCount : 1,
        extraColumns: extra,
        commands,
        createdAt: t.createdAt || new Date().toISOString(),
      };
    });
    return { loadedSetId: id, loadedSetTable: list };
  }),
  restoreSavedTestCasesFromProfile: () => set(() => {
    const list = loadSavedTestCases();
    return { savedTestCases: list, loadedSetId: null, loadedSetTable: [] };
  }),
  setLoadedSetId: (id) => set((state) => ({ loadedSetId: id ?? null, loadedSetTable: id ? state.loadedSetTable : [] })),

  /** Merge full library view (savedTestCases + unique items from sets) into savedTestCases and persist. Use before navigating to Test Cases so the table shows all library rows. */
  syncFullLibraryToSavedTestCases: () => set((state) => {
    const contentKey = (tc) => [tc.name ?? '', tc.vcdName ?? '', tc.binName ?? '', tc.linName ?? ''].join('\0');
    const fromCurrent = state.savedTestCases || [];
    const seen = new Set(fromCurrent.map(contentKey));
    const fromSets = (state.savedTestCaseSets || []).flatMap((set) =>
      (Array.isArray(set.items) ? set.items : []).map((t) => ({
        ...t,
        id: t.id || `tc-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      }))
    );
    const toAddRaw = fromSets.filter((tc) => {
      const key = contentKey(tc);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (toAddRaw.length === 0) return {};
    const usedNames = buildGlobalTestCaseNameSet(state, null, []);
    const toAdd = toAddRaw.map((tc) => {
      const base = normalizeTestCaseName(tc.name) || 'Test case';
      const name = pickUniqueTestCaseName(base, usedNames);
      usedNames.add(name);
      return { ...tc, name };
    });
    const next = [...fromCurrent, ...toAdd];
    saveSavedTestCases(next);
    const activeId = getActiveProfileId();
    if (isBackendProfileId(activeId)) {
      const p = loadProfile(activeId);
      void api.putProfileData(activeId, { savedTestCases: next, savedTestCaseSets: p?.savedTestCaseSets ?? [] }).catch((err) => {
        console.error('[putProfileData failed: append TCs]', err);
        try { get().addToast?.({ type: 'error', message: `Save to server failed: ${err?.message || err}` }); } catch { /* ignore */ }
      });
    }
    return { savedTestCases: next };
  }),

  appendSavedTestCaseSet: (id) => {
    const exists = (get().savedTestCaseSets || []).some((s) => s.id === id);
    if (!exists) return;
    if (!beginSavedTestCaseSetPending(id, 'append')) return;
    try {
      set((state) => {
        const setEntry = state.savedTestCaseSets.find((s) => s.id === id);
        if (!setEntry) return state;

    // ถ้ากำลังแก้ไข Set ใดอยู่ → append เข้า table ของ Set นั้น (loadedSetTable)
    if (state.loadedSetId) {
      const baseList = Array.isArray(state.loadedSetTable) ? state.loadedSetTable : [];
      const contentKey = (t) => [
        (t.name || '').trim(),
        (t.vcdName || '').trim(),
        (t.binName || '').trim(),
        (t.linName || '').trim(),
      ].join('\0');
      const seen = new Set(baseList.map(contentKey));
      const usedNames = buildGlobalTestCaseNameSet(state, null, []);
      const appended = (setEntry.items || [])
        // ถ้าใน 2 set มี test case content ซ้ำกัน ให้ใช้แค่ตัวที่มีอยู่แล้ว (ไม่สร้างซ้ำ)
        .filter((t) => {
          const key = contentKey(t);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map((t) => {
          const base = normalizeTestCaseName(t.name) || 'Test case';
          const name = pickUniqueTestCaseName(base, usedNames);
          usedNames.add(name);
          const extra = t.extraColumns && typeof t.extraColumns === 'object' ? { ...t.extraColumns } : {};
          const commands = [];
          ['VCD2', 'VCD3', 'VCD4', 'ERoM2', 'ERoM3', 'ULP2', 'ULP3'].forEach((col) => {
            const v = (extra[col] ?? '').toString().trim();
            if (v) {
              const type = col.startsWith('VCD') ? 'vcd' : col.startsWith('ERoM') ? 'erom' : 'ulp';
              commands.push({ id: `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`, type, file: v });
              delete extra[col];
            }
          });
          return {
            id: `tc-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            name,
            vcdName: t.vcdName || '',
            binName: t.binName || '',
            linName: t.linName || '',
            boardId: t.boardId || '',
            tryCount: typeof t.tryCount === 'number' && t.tryCount > 0 ? t.tryCount : 1,
            extraColumns: extra,
            commands,
            createdAt: t.createdAt || new Date().toISOString(),
          };
        });
      if (!appended.length) return state;
      return { loadedSetTable: [...baseList, ...appended] };
    }

    // กรณีไม่ได้แก้ไข Set ใดอยู่ → append เข้า Library test cases (savedTestCases)
    const baseList = Array.isArray(state.savedTestCases) ? state.savedTestCases : [];
    const contentKey = (tc) => [
      (tc.name || '').trim(),
      (tc.vcdName || '').trim(),
      (tc.binName || '').trim(),
      (tc.linName || '').trim(),
    ].join('\0');
    const seen = new Set(baseList.map(contentKey));
    const usedNames = buildGlobalTestCaseNameSet(state, null, []);

    const appended = (setEntry.items || [])
      .filter((t) => {
        const key = contentKey(t);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((t) => {
        const base = normalizeTestCaseName(t.name) || 'Test case';
        const name = pickUniqueTestCaseName(base, usedNames);
        usedNames.add(name);
        return {
          id: `tc-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          name,
          vcdName: t.vcdName || '',
          binName: t.binName || '',
          linName: t.linName || '',
          boardId: t.boardId || '',
          tryCount: typeof t.tryCount === 'number' && t.tryCount > 0 ? t.tryCount : 1,
          extraColumns: t.extraColumns && typeof t.extraColumns === 'object' ? { ...t.extraColumns } : {},
          createdAt: t.createdAt || new Date().toISOString(),
        };
      });

    if (!appended.length) return state;
    const next = [...baseList, ...appended];
    saveSavedTestCases(next);
    return { savedTestCases: next };
      });
    } finally {
      queueMicrotask(() => endSavedTestCaseSetPending(id));
    }
  },

  // Profile Management (no login/logout)
  createProfile: async (name) => {
    const displayName = (name || 'New Profile').trim();
    let id;
    try {
      const res = await api.createProfileApi(displayName);
      id = res.id;
      name = res.name || displayName;
    } catch (e) {
      id = `profile-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      name = displayName;
    }
    const newProfile = {
      id,
      name,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      savedTestCases: [],
      savedTestCaseSets: [],
      preferences: {},
    };
    saveProfile(id, newProfile);
    const profiles = loadProfilesList();
    profiles.push({ id, name });
    saveProfilesList(profiles);
    set({ profiles, activeProfileId: id, savedTestCases: [], savedTestCaseSets: [], workingTestCases: [] });
    return id;
  },
  switchProfile: (profileId) => {
    const profile = loadProfile(profileId);
    if (!profile) {
      console.error(`Profile ${profileId} not found`);
      return false;
    }
    localStorage.setItem(ACTIVE_PROFILE_ID_KEY, profileId);
    const testCases = profile.savedTestCases || [];
    const sets = profile.savedTestCaseSets || [];
    set({
      activeProfileId: profileId,
      savedTestCases: testCases,
      savedTestCaseSets: sets,
      workingTestCases: [],
      viewingSharedProfileId: null,
    });
    if (isBackendProfileId(profileId)) {
      void api.getProfileData(profileId).then((data) => {
        const merged = { savedTestCases: data.savedTestCases ?? testCases, savedTestCaseSets: data.savedTestCaseSets ?? sets };
        let mergePrefs = false;
        if (data && typeof data === 'object' && data.preferences != null && typeof data.preferences === 'object') {
          merged.preferences = { ...(profile.preferences || {}), ...data.preferences };
          mergePrefs = true;
        }
        saveProfile(profileId, { ...profile, ...merged });
        set((s) => ({
          savedTestCases: merged.savedTestCases,
          savedTestCaseSets: merged.savedTestCaseSets,
          ...(mergePrefs ? { tcViewerTagEpoch: (s.tcViewerTagEpoch || 0) + 1 } : {}),
        }));
      }).catch(() => {});
    }
    rememberClientOwnerLabel(getClientId(), profile.name || profileId);
    void get().refreshGlobalTestCaseData();
    return true;
  },
  deleteProfile: (profileId) => {
    if (profileId === 'default') {
      console.error('Cannot delete default profile');
      return false;
    }
    const profiles = loadProfilesList();
    const filtered = profiles.filter((p) => p.id !== profileId);
    saveProfilesList(filtered);
    localStorage.removeItem(`${PROFILE_DATA_PREFIX}${profileId}`);
    const currentActive = get().activeProfileId;
    if (currentActive === profileId) {
      get().switchProfile('default');
    }
    // Always sync list into Zustand (switchProfile does not update `profiles`).
    set({ profiles: filtered });
    if (isBackendProfileId(profileId)) {
      void api
        .deleteProfileApi(profileId)
        .then(() => {
          void get().refreshServerProfileDirectory();
          void get().refreshGlobalTestCaseData();
        })
        .catch((e) => {
          console.warn('deleteProfile: server delete failed', profileId, e);
        });
    }
    return true;
  },
  updateProfileName: (profileId, newName) => {
    const profile = loadProfile(profileId);
    if (!profile) return false;
    const updated = { ...profile, name: newName };
    saveProfile(profileId, updated);
    const profiles = loadProfilesList();
    const updatedProfiles = profiles.map((p) => (p.id === profileId ? { ...p, name: newName } : p));
    saveProfilesList(updatedProfiles);
    set({ profiles: updatedProfiles });
    if (isBackendProfileId(profileId)) {
      void api.updateProfileNameApi(profileId, newName).catch(() => {});
    }
    return true;
  },
  exportProfile: async (profileId, includeHistory = false) => {
    const targetId = profileId || get().activeProfileId;
    const profile = loadProfile(targetId);
    if (!profile) {
      throw new Error(`Profile ${targetId} not found`);
    }
    let exportData = { ...profile };
    if (includeHistory) {
      try {
        // Fetch current jobs from API as history snapshot
        const jobs = get().jobs || [];
        exportData.historySnapshot = {
          exportedAt: new Date().toISOString(),
          jobs: jobs.map((j) => ({
            id: j.id,
            name: j.name,
            tag: j.tag,
            status: j.status,
            progress: j.progress,
            completedFiles: j.completedFiles,
            totalFiles: j.totalFiles,
            firmware: j.firmware,
            boards: j.boards,
            createdAt: j.createdAt,
            startedAt: j.startedAt,
            completedAt: j.completedAt,
          })),
        };
      } catch (e) {
        console.error('Failed to fetch history snapshot', e);
      }
    }
    return exportData;
  },
  importProfile: (profileData, options = {}) => {
    const { name: newName, overwriteId } = options;
    let targetId = overwriteId;
    if (!targetId) {
      // Create new profile from imported data
      targetId = `profile-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    }
    const importedProfile = {
      id: targetId,
      name: newName || profileData.name || 'Imported Profile',
      createdAt: profileData.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      savedTestCases: profileData.savedTestCases || [],
      savedTestCaseSets: profileData.savedTestCaseSets || [],
      preferences: profileData.preferences || {},
      historySnapshot: profileData.historySnapshot,
    };
    saveProfile(targetId, importedProfile);
    const profiles = loadProfilesList();
    const existingIndex = profiles.findIndex((p) => p.id === targetId);
    if (existingIndex >= 0) {
      profiles[existingIndex] = { id: targetId, name: importedProfile.name };
    } else {
      profiles.push({ id: targetId, name: importedProfile.name });
    }
    saveProfilesList(profiles);
    set({ profiles });
    if (options.switchToImported) {
      get().switchProfile(targetId);
    }
    return targetId;
  },
  getProfileHistorySnapshot: (profileId) => {
    const targetId = profileId || get().activeProfileId;
    const profile = loadProfile(targetId);
    return profile?.historySnapshot || null;
  },

  // Shared profiles (view / copy from teammate)
  addSharedProfile: async (profileId) => {
    const id = (profileId || '').trim();
    if (!id) return { ok: false, error: 'Profile ID required' };
    if (loadSharedProfilesList().some((p) => p.id === id)) return { ok: true };
    try {
      const meta = await api.getProfile(id);
      const data = await api.getProfileData(id);
      const list = loadSharedProfilesList();
      list.push({ id, name: meta.name || id });
      saveSharedProfilesList(list);
      set((state) => ({
        sharedProfiles: list,
        sharedProfileDataCache: { ...state.sharedProfileDataCache, [id]: data },
      }));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e?.message || 'Failed to load profile' };
    }
  },
  removeSharedProfile: (profileId) => {
    const list = loadSharedProfilesList().filter((p) => p.id !== profileId);
    saveSharedProfilesList(list);
    set((state) => {
      const cache = { ...state.sharedProfileDataCache };
      delete cache[profileId];
      return {
        sharedProfiles: list,
        sharedProfileDataCache: cache,
        viewingSharedProfileId: state.viewingSharedProfileId === profileId ? null : state.viewingSharedProfileId,
      };
    });
  },
  setViewingSharedProfile: (profileId) => {
    set({ viewingSharedProfileId: profileId || null });
  },
  fetchSharedProfileData: async (profileId) => {
    try {
      const data = await api.getProfileData(profileId);
      set((state) => ({ sharedProfileDataCache: { ...state.sharedProfileDataCache, [profileId]: data } }));
      return data;
    } catch (e) {
      return null;
    }
  },
  copySharedToMyProfile: () => {
    const state = get();
    const sid = state.viewingSharedProfileId;
    if (!sid) return false;
    const data = state.sharedProfileDataCache[sid];
    if (!data) return false;
    const cases = Array.isArray(data.savedTestCases) ? data.savedTestCases : [];
    const sets = Array.isArray(data.savedTestCaseSets) ? data.savedTestCaseSets : [];
    const activeId = getActiveProfileId();
    const profile = loadProfile(activeId);
    const mergedCases = [...(profile?.savedTestCases || []), ...cases];
    const mergedSets = [...(profile?.savedTestCaseSets || []), ...sets];
    saveProfile(activeId, { ...profile, savedTestCases: mergedCases, savedTestCaseSets: mergedSets });
    set({ savedTestCases: mergedCases, savedTestCaseSets: mergedSets, viewingSharedProfileId: null });
    if (isBackendProfileId(activeId)) {
      void api.putProfileData(activeId, { savedTestCases: mergedCases, savedTestCaseSets: mergedSets }).catch((err) => {
        console.error('[putProfileData failed: merge from shared profile]', err);
        try { get().addToast?.({ type: 'error', message: `Merge save to server failed: ${err?.message || err}` }); } catch { /* ignore */ }
      });
    }
    return true;
  },

  /**
   * Local + server: per-viewer tag overlay for a library TC id (when the TC is owned by another profile).
   * Stored under `profile.preferences.tcViewerTagOverlays[testCaseId]` with the same shape as `extraColumns` tag fields.
   */
  getViewerTcTagOverlays: () => {
    const id = get().activeProfileId;
    if (!id) return {};
    const p = loadProfile(id);
    const o = p?.preferences?.tcViewerTagOverlays;
    return o && typeof o === 'object' ? o : {};
  },

  patchViewerTcTagOverlay: (testCaseId, extraOrNull) => {
    const id = get().activeProfileId;
    if (!id || testCaseId == null) return;
    const sid = String(testCaseId);
    const p = loadProfile(id) || {};
    const prevPref = p.preferences && typeof p.preferences === 'object' ? p.preferences : {};
    const overlays = { ...(prevPref.tcViewerTagOverlays || {}) };
    if (extraOrNull == null) {
      delete overlays[sid];
    } else {
      overlays[sid] = { ...extraOrNull };
    }
    const nextPreferences = { ...prevPref, tcViewerTagOverlays: overlays };
    saveProfile(id, { ...p, preferences: nextPreferences });
    if (isBackendProfileId(id)) {
      void api.putProfileData(id, { preferences: nextPreferences }).catch((err) => {
        console.error('[putProfileData failed: tcViewerTagOverlays]', err);
        try {
          get().addToast?.({ type: 'error', message: `บันทึก tag ส่วนตัวไปเซิร์ฟเวอร์ไม่สำเร็จ: ${err?.message || err}` });
        } catch {
          /* ignore */
        }
      });
    }
    set((s) => ({ tcViewerTagEpoch: (s.tcViewerTagEpoch || 0) + 1 }));
  },

  isBackendProfileId: (id) => isBackendProfileId(id),

  updateProgress: (id, val) => set((state) => ({
    jobs: state.jobs.map(j => j.id === id ? { ...j, progress: val } : j)
  })),
  setFleetViewMode: (mode) => set({ fleetViewMode: mode }),
  setFleetFilter: (key, value) => set((state) => ({
    fleetFilters: { ...state.fleetFilters, [key]: value }
  })),
  toggleBoardSelection: (boardId) => set((state) => ({
    selectedBoards: state.selectedBoards.includes(boardId)
      ? state.selectedBoards.filter(id => id !== boardId)
      : [...state.selectedBoards, boardId]
  })),
  selectAllBoards: () => set((state) => ({
    selectedBoards: state.boards.map(b => b.id)
  })),
  clearBoardSelection: () => set({ selectedBoards: [] }),
  setJobFilter: (filter) => set({ selectedJobFilter: filter }),
  markNotificationRead: (id) => {
    if (typeof id === 'string' && id.startsWith('local-')) {
      set((state) => ({
        localNotifications: state.localNotifications.map(n => n.id === id ? { ...n, read: true } : n)
      }));
      return;
    }
    set((state) => ({
      notifications: state.notifications.map(n => n.id === id ? { ...n, read: true } : n)
    }));
    void api.markNotificationRead(id)
      .then(() => get().refreshNotifications())
      .catch((error) => console.error('Failed to mark notification read', error));
  },
  markAllNotificationsRead: () => {
    const ownerKey = get().activeProfileId || getClientId();
    set((state) => ({
      notifications: state.notifications.map(n => ({ ...n, read: true })),
      localNotifications: state.localNotifications.map(n => ({ ...n, read: true }))
    }));
    void api.markAllNotificationsRead({ user_id: ownerKey })
      .then(() => get().refreshNotifications())
      .catch((error) => console.error('Failed to mark all notifications read', error));
  },
  updateSystemHealth: (health) => set((state) => ({
    systemHealth: { ...state.systemHealth, ...health }
  })),

  // Backend sync actions
  refreshSystemHealth: async () => {
    try {
      set((state) => ({
        loading: { ...state.loading, systemHealth: true },
        errors: { ...state.errors, systemHealth: null },
      }));
      const data = await api.getSystemHealth();
      set((state) => ({ systemHealth: { ...state.systemHealth, ...data } }));
      return data;
    } catch (error) {
      console.error('Failed to refresh system health', error);
      set((state) => ({
        errors: { ...state.errors, systemHealth: error?.message || 'Failed to load system health' },
      }));
      return null;
    } finally {
      set((state) => ({ loading: { ...state.loading, systemHealth: false } }));
    }
  },
  // Silent refresh – ไม่แตะ loading/errors ใช้กับ auto-poll เพื่อไม่ให้ UI กระพริบ
  silentRefreshSystemHealth: async () => {
    try {
      const data = await api.getSystemHealth();
      set((state) => ({ systemHealth: { ...state.systemHealth, ...data } }));
      return data;
    } catch (error) {
      console.error('Failed to silent refresh system health', error);
      return null;
    }
  },
  refreshBoards: async () => {
    try {
      set((state) => ({
        loading: { ...state.loading, boards: true },
        errors: { ...state.errors, boards: null },
      }));
      const data = await api.getBoards();
      set((state) => {
        const prevBoards = state.boards || [];
        const now = new Date().toISOString();
        const newLocal = [];
        (data || []).forEach((b) => {
          const prev = prevBoards.find((p) => p.id === b.id);
          const prevStatus = (prev?.status || '').toLowerCase();
          const newStatus = (b.status || '').toLowerCase();
          const prevArm = (prev?.armStatus || '').toLowerCase();
          const newArm = (b.armStatus || '').toLowerCase();
          const prevFpga = (prev?.fpgaStatus || '').toLowerCase();
          const newFpga = (b.fpgaStatus || '').toLowerCase();
          const wasError =
            prevStatus === 'error' ||
            prevStatus === 'offline' ||
            prevArm === 'error' ||
            prevFpga === 'error';
          const isError =
            newStatus === 'error' ||
            newStatus === 'offline' ||
            newArm === 'error' ||
            newFpga === 'error';
          if (!wasError && isError) {
            newLocal.push({
              id: `local-board-${b.id}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
              title: 'Board error',
              message: `${b.name || b.id} is in error state`,
              type: 'error',
              read: false,
              createdAt: now,
            });
          }
        });
        const localNotifications = [...newLocal, ...(state.localNotifications || [])];
        return { boards: data, localNotifications };
      });
      return data;
    } catch (error) {
      console.error('Failed to refresh boards', error);
      set((state) => ({
        errors: { ...state.errors, boards: error?.message || 'Failed to load boards' },
      }));
      return null;
    } finally {
      set((state) => ({ loading: { ...state.loading, boards: false } }));
    }
  },
  silentRefreshBoards: async () => {
    try {
      const data = await api.getBoards();
      set((state) => {
        const prevBoards = state.boards || [];
        const now = new Date().toISOString();
        const newLocal = [];
        (data || []).forEach((b) => {
          const prev = prevBoards.find((p) => p.id === b.id);
          const prevStatus = (prev?.status || '').toLowerCase();
          const newStatus = (b.status || '').toLowerCase();
          const prevArm = (prev?.armStatus || '').toLowerCase();
          const newArm = (b.armStatus || '').toLowerCase();
          const prevFpga = (prev?.fpgaStatus || '').toLowerCase();
          const newFpga = (b.fpgaStatus || '').toLowerCase();
          const wasError =
            prevStatus === 'error' ||
            prevStatus === 'offline' ||
            prevArm === 'error' ||
            prevFpga === 'error';
          const isError =
            newStatus === 'error' ||
            newStatus === 'offline' ||
            newArm === 'error' ||
            newFpga === 'error';
          if (!wasError && isError) {
            newLocal.push({
              id: `local-board-${b.id}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
              title: 'Board error',
              message: `${b.name || b.id} is in error state`,
              type: 'error',
              read: false,
              createdAt: now,
            });
          }
        });
        const localNotifications = [...newLocal, ...(state.localNotifications || [])];
        return {
          boards: data,
          localNotifications,
          errors: { ...state.errors, boards: null },
        };
      });
      return data;
    } catch (error) {
      console.error('Failed to silent refresh boards', error);
      return null;
    }
  },
  refreshServerProfileDirectory: async () => {
    try {
      const data = await api.listProfiles();
      const list = (Array.isArray(data) ? data : []).map((p) => ({
        id: p.id,
        name: String(p.name || '').trim() || p.id,
      }));
      set({ serverProfileDirectory: list });
      return list;
    } catch (e) {
      console.error('Failed to refresh server profile directory', e);
      return null;
    }
  },
  refreshJobs: async () => {
    try {
      set((state) => ({
        loading: { ...state.loading, jobs: true },
        errors: { ...state.errors, jobs: null },
      }));
      await get().refreshServerProfileDirectory();
      const data = await api.getJobs();
      syncOwnerLabelsFromJobs(
        data,
        get().profiles || [],
        get().sharedProfiles || [],
        get().serverProfileDirectory || []
      );
      set((state) => {
        const prevJobs = state.jobs || [];
        // ใช้ชื่อ test case ไม่ใช่ชื่อไฟล์ — แมป test_case_name จาก API ถ้า testCaseName ว่าง
        const jobs = (data || []).map((j) => ({
          ...j,
          files: (j.files || []).map((f) => ({
            ...f,
            testCaseName: f.testCaseName ?? f.test_case_name,
          })),
        }));
        const deltas = buildMyJobLocalNotifications(
          prevJobs,
          jobs,
          state.activeProfileId,
          getClientId()
        );
        queueMicrotask(() => {
          const userKey = get().activeProfileId || getClientId();
          deltas.forEach((d) => {
            if (d._attention) {
              get().showJobAttentionBanner({
                title: d.title,
                message: d.message,
                type: d.type,
                jobId: d.data?.jobId,
              });
            }
            const row = stripAttentionFields(d);
            void api
              .createNotification({
                title: row.title,
                message: row.message || '',
                type: row.type || 'info',
                user_id: userKey,
                data: row.data,
              })
              .catch(() => {});
          });
          if (deltas.length) void get().silentRefreshNotifications();
        });
        return { jobs, localNotifications: state.localNotifications };
      });
      return data;
    } catch (error) {
      console.error('Failed to refresh jobs', error);
      set((state) => ({
        errors: { ...state.errors, jobs: error?.message || 'Failed to load jobs' },
      }));
      return null;
    } finally {
      set((state) => ({ loading: { ...state.loading, jobs: false } }));
    }
  },
  silentRefreshJobs: async () => {
    try {
      await get().refreshServerProfileDirectory();
      const data = await api.getJobs();
      syncOwnerLabelsFromJobs(
        data,
        get().profiles || [],
        get().sharedProfiles || [],
        get().serverProfileDirectory || []
      );
      set((state) => {
        const prevJobs = state.jobs || [];
        const jobs = (data || []).map((j) => ({
          ...j,
          files: (j.files || []).map((f) => ({ ...f, testCaseName: f.testCaseName ?? f.test_case_name })),
        }));
        const deltas = buildMyJobLocalNotifications(
          prevJobs,
          jobs,
          state.activeProfileId,
          getClientId()
        );
        queueMicrotask(() => {
          const userKey = get().activeProfileId || getClientId();
          deltas.forEach((d) => {
            if (d._attention) {
              get().showJobAttentionBanner({
                title: d.title,
                message: d.message,
                type: d.type,
                jobId: d.data?.jobId,
              });
            }
            const row = stripAttentionFields(d);
            void api
              .createNotification({
                title: row.title,
                message: row.message || '',
                type: row.type || 'info',
                user_id: userKey,
                data: row.data,
              })
              .catch(() => {});
          });
          if (deltas.length) void get().silentRefreshNotifications();
        });
        return { jobs, localNotifications: state.localNotifications };
      });
      return data;
    } catch (error) {
      console.error('Failed to silent refresh jobs', error);
      return null;
    }
  },
  refreshNotifications: async () => {
    try {
      set((state) => ({
        loading: { ...state.loading, notifications: true },
        errors: { ...state.errors, notifications: null },
      }));
      const ownerKey = get().activeProfileId || getClientId();
      const data = await api.getNotifications({ user_id: ownerKey, limit: 100 });
      set({ notifications: data });
      return data;
    } catch (error) {
      console.error('Failed to refresh notifications', error);
      set((state) => ({
        errors: { ...state.errors, notifications: error?.message || 'Failed to load notifications' },
      }));
      return null;
    } finally {
      set((state) => ({ loading: { ...state.loading, notifications: false } }));
    }
  },
  silentRefreshNotifications: async () => {
    try {
      const ownerKey = get().activeProfileId || getClientId();
      const data = await api.getNotifications({ user_id: ownerKey, limit: 100 });
      set({ notifications: data });
      return data;
    } catch (error) {
      console.error('Failed to silent refresh notifications', error);
      return null;
    }
  },
  refreshFiles: async () => {
    try {
      set((state) => ({
        loading: { ...state.loading, files: true },
        errors: { ...state.errors, files: null },
      }));
      await get().refreshServerProfileDirectory();
      let data = await api.getFiles();
      const migrated = await migrateLocalFileTagsToServer(data);
      if (migrated) data = await api.getFiles();
      // Server is the source of truth for file tags/colors (shared across profiles/devices).
      // Keep store maps in sync so other machines immediately see tag updates.
      const mergedMaps = buildFileTagMapsFromApiFiles(data);
      const mapped = (data || []).map((file) => ({
        id: file.id,
        name: file.name,
        originalName: file.name,
        size: file.size,
        sizeFormatted: formatFileSize(file.size || 0),
        date: file.uploadDate || '',
        type: inferFileType(file.name, file.type),
        file: null,
        uploadDate: file.uploadDate,
        updatedAt: file.updatedAt ?? file.updated_at ?? null,
        checksum: file.checksum || null,
        ownerId: file.ownerId ?? file.owner_id ?? null,
        ownerName: file.ownerName ?? file.owner_name ?? null,
        visibility: file.visibility || 'public',
        tags: file.tags,
        tagColor: file.tagColor,
      }));
      syncOwnerLabelsFromFiles(mapped);
      set({
        uploadedFiles: mapped,
        vcdFiles: mapped.filter((f) => f.type === 'vcd'),
        firmwareFiles: mapped.filter((f) => f.type !== 'vcd'),
        fileTags: mergedMaps.fileTags,
        fileTagColors: mergedMaps.fileTagColors,
      });
      saveFileTags(mergedMaps.fileTags);
      saveFileTagColors(mergedMaps.fileTagColors);
      return data;
    } catch (error) {
      console.error('Failed to refresh files', error);
      set((state) => ({
        errors: { ...state.errors, files: error?.message || 'Failed to load files' },
      }));
      return null;
    } finally {
      set((state) => ({ loading: { ...state.loading, files: false } }));
    }
  },
  silentRefreshFiles: async () => {
    try {
      await get().refreshServerProfileDirectory();
      let data = await api.getFiles();
      const migrated = await migrateLocalFileTagsToServer(data);
      if (migrated) data = await api.getFiles();
      // Keep fileTags/fileTagColors in sync with server (shared across devices).
      const mergedMaps = buildFileTagMapsFromApiFiles(data);
      const mapped = (data || []).map((file) => ({
        id: file.id,
        name: file.name,
        originalName: file.name,
        size: file.size,
        sizeFormatted: formatFileSize(file.size || 0),
        date: file.uploadDate || '',
        type: inferFileType(file.name, file.type),
        file: null,
        uploadDate: file.uploadDate,
        updatedAt: file.updatedAt ?? file.updated_at ?? null,
        checksum: file.checksum || null,
        ownerId: file.ownerId ?? file.owner_id ?? null,
        ownerName: file.ownerName ?? file.owner_name ?? null,
        visibility: file.visibility || 'public',
        tags: file.tags,
        tagColor: file.tagColor,
      }));
      syncOwnerLabelsFromFiles(mapped);
      set({
        uploadedFiles: mapped,
        vcdFiles: mapped.filter((f) => f.type === 'vcd'),
        firmwareFiles: mapped.filter((f) => f.type !== 'vcd'),
        fileTags: mergedMaps.fileTags,
        fileTagColors: mergedMaps.fileTagColors,
      });
      saveFileTags(mergedMaps.fileTags);
      saveFileTagColors(mergedMaps.fileTagColors);
      return data;
    } catch (error) {
      console.error('Failed to silent refresh files', error);
      return null;
    }
  },
  /**
   * File Library "All": merge GET /profiles/all-test-cases with every profile’s localStorage copy.
   * Server DB may lag or omit profiles that exist only on this browser — without this, "All" looked like "Mine".
   */
  aggregateSavedTestCasesAcrossProfiles: () => {
    const state = get();
    const globalCases = Array.isArray(state.globalSavedTestCases) ? state.globalSavedTestCases : [];
    const profileList = Array.isArray(state.profiles) ? state.profiles : [];
    const serverDir = Array.isArray(state.serverProfileDirectory) ? state.serverProfileDirectory : [];
    const byId = new Map();

    const enrichOwner = (row) => {
      if (!row) return row;
      let r = { ...row };
      const oid = r._ownerId;
      if (!oid) return r;
      const badName = !r._ownerName || String(r._ownerName).trim() === '' || String(r._ownerName).trim() === 'Default';
      if (badName) {
        const p = profileList.find((x) => String(x.id) === String(oid));
        const sn = serverDir.find((x) => String(x.id) === String(oid));
        if (p?.name && String(p.name).trim() !== 'Default') r._ownerName = p.name;
        else if (sn?.name && String(sn.name).trim() !== 'Default') r._ownerName = sn.name;
        else if (p?.name) r._ownerName = p.name;
        else if (sn?.name) r._ownerName = sn.name;
      }
      return r;
    };

    globalCases.forEach((tc) => {
      if (!tc || tc.id == null) return;
      byId.set(String(tc.id), enrichOwner({ ...tc }));
    });
    profileList.forEach((p) => {
      const prof = loadProfile(p.id);
      (prof?.savedTestCases || []).forEach((tc) => {
        if (!tc || tc.id == null) return;
        const id = String(tc.id);
        const localRow = enrichOwner({
          ...tc,
          _ownerId: p.id,
          _ownerName: p.name || p.id,
        });
        if (!byId.has(id)) {
          byId.set(id, localRow);
        } else {
          byId.set(id, enrichOwner(mergeSavedTestCaseRow(byId.get(id), localRow)));
        }
      });
    });
    return Array.from(byId.values());
  },
  aggregateSavedTestCaseSetsAcrossProfiles: () => {
    const state = get();
    const globalSets = Array.isArray(state.globalSavedTestCaseSets) ? state.globalSavedTestCaseSets : [];
    const profileList = Array.isArray(state.profiles) ? state.profiles : [];
    const serverDir = Array.isArray(state.serverProfileDirectory) ? state.serverProfileDirectory : [];
    const byId = new Map();

    const enrichOwner = (row) => {
      if (!row) return row;
      let r = { ...row };
      const oid = r._ownerId;
      if (!oid) return r;
      const badName = !r._ownerName || String(r._ownerName).trim() === '' || String(r._ownerName).trim() === 'Default';
      if (badName) {
        const p = profileList.find((x) => String(x.id) === String(oid));
        const sn = serverDir.find((x) => String(x.id) === String(oid));
        if (p?.name && String(p.name).trim() !== 'Default') r._ownerName = p.name;
        else if (sn?.name && String(sn.name).trim() !== 'Default') r._ownerName = sn.name;
        else if (p?.name) r._ownerName = p.name;
        else if (sn?.name) r._ownerName = sn.name;
      }
      return r;
    };

    globalSets.forEach((s) => {
      if (!s || s.id == null) return;
      byId.set(String(s.id), enrichOwner({ ...s }));
    });
    profileList.forEach((p) => {
      const prof = loadProfile(p.id);
      (prof?.savedTestCaseSets || []).forEach((set) => {
        if (!set || set.id == null) return;
        const id = String(set.id);
        const localRow = enrichOwner({
          ...set,
          _ownerId: p.id,
          _ownerName: p.name || p.id,
        });
        if (!byId.has(id)) {
          byId.set(id, localRow);
        } else {
          byId.set(id, enrichOwner(mergeSavedSetRow(byId.get(id), localRow)));
        }
      });
    });
    return Array.from(byId.values());
  },
  /**
   * Register every local profile row on the server (POST + PUT) so GET /profiles/all-test-cases
   * aggregates all users/profiles. Skips when API is down. Migrates `default` / `profile-*` ids to server UUIDs.
   */
  ensureLocalProfilesSyncedToServer: async () => {
    let localProfiles = loadProfilesList();
    if (!Array.isArray(localProfiles) || !localProfiles.length) return;

    let serverList;
    try {
      serverList = await api.listProfiles();
    } catch (e) {
      return;
    }
    const serverIds = new Set((Array.isArray(serverList) ? serverList : []).map((p) => p.id));

    let needsWork = false;
    for (const p of localProfiles) {
      if (!isBackendProfileId(p.id)) {
        needsWork = true;
        break;
      }
      if (!serverIds.has(p.id)) {
        needsWork = true;
        break;
      }
    }
    if (!needsWork) return;

    let changed = false;
    const prevActive = get().activeProfileId;
    let nextActive = prevActive;

    const migrateToNewServerProfile = async (oldId, displayName) => {
      const data = loadProfile(oldId) || {
        savedTestCases: [],
        savedTestCaseSets: [],
        preferences: {},
      };
      const res = await api.createProfileApi(displayName);
      const newId = res.id;
      const merged = {
        ...data,
        id: newId,
        name: res.name || displayName,
      };
      saveProfile(newId, merged);
      localStorage.removeItem(`${PROFILE_DATA_PREFIX}${oldId}`);
      await api.putProfileData(newId, {
        savedTestCases: merged.savedTestCases ?? [],
        savedTestCaseSets: merged.savedTestCaseSets ?? [],
      });
      return { newId, name: merged.name };
    };

    for (let i = 0; i < localProfiles.length; i++) {
      const entry = localProfiles[i];
      const oldId = entry.id;
      const displayName = (entry.name || 'Profile').trim() || 'Profile';

      if (isBackendProfileId(oldId) && serverIds.has(oldId)) {
        continue;
      }

      if (isBackendProfileId(oldId) && !serverIds.has(oldId)) {
        try {
          const ld = loadProfile(oldId);
          await api.putProfileData(oldId, {
            savedTestCases: ld?.savedTestCases ?? [],
            savedTestCaseSets: ld?.savedTestCaseSets ?? [],
          });
          serverIds.add(oldId);
          continue;
        } catch (e) {
          if (e.status !== 404) {
            console.warn('ensureLocalProfilesSyncedToServer: PUT failed', oldId, e);
            continue;
          }
        }
      }

      try {
        const { newId, name } = await migrateToNewServerProfile(oldId, displayName);
        localProfiles[i] = { id: newId, name };
        serverIds.add(newId);
        changed = true;
        if (nextActive === oldId) nextActive = newId;
      } catch (e) {
        console.warn('ensureLocalProfilesSyncedToServer: migrate failed', oldId, e);
      }
    }

    if (changed) {
      saveProfilesList(localProfiles);
      if (nextActive !== prevActive) {
        localStorage.setItem(ACTIVE_PROFILE_ID_KEY, nextActive);
      }
      const p = loadProfile(nextActive);
      set({
        profiles: localProfiles,
        activeProfileId: nextActive,
        savedTestCases: p?.savedTestCases ?? [],
        savedTestCaseSets: p?.savedTestCaseSets ?? [],
        workingTestCases: [],
      });
    }
  },
  refreshGlobalTestCaseData: async () => {
    try {
      await get().ensureLocalProfilesSyncedToServer();
      const res = await api.getAllTestCasesFromProfiles();
      set({
        globalSavedTestCases: Array.isArray(res?.savedTestCases) ? res.savedTestCases : [],
        globalSavedTestCaseSets: Array.isArray(res?.savedTestCaseSets) ? res.savedTestCaseSets : [],
        globalTestCaseDataLoaded: true,
      });
      void get().refreshServerProfileDirectory();
    } catch (e) {
      console.error('Failed to refresh global test-case data', e);
      set({
        globalSavedTestCases: [],
        globalSavedTestCaseSets: [],
        globalTestCaseDataLoaded: true,
      });
    }
  },

  refreshAll: async () => {
    await Promise.allSettled([
      get().refreshSystemHealth(),
      get().refreshBoards(),
      get().refreshJobs(),
      get().refreshNotifications(),
      get().refreshFiles(),
      get().refreshGlobalTestCaseData(),
    ]);
  },
  
  // Job Management Actions
  createJob: async (jobPayload, options = {}) => {
    try {
      const clientId = getClientId();
      const profileId = get().activeProfileId || null;
      const profileDisplayName = getActiveProfileDisplayNameForSnapshot(get);
      const payload = { ...jobPayload, clientId, profileId, profileDisplayName };
      const created = await api.createJob(payload);
      await get().refreshJobs();
      if (created?.id && options.startImmediately) {
        await api.startJob(created.id);
        await get().refreshJobs();
      }
      return created;
    } catch (error) {
      console.error('Failed to create job', error);
      const d = error?.detail;
      if (error?.status === 409 && d?.code === 'FILE_MODIFIED') {
        const msg = d.message || 'One or more files were modified after upload.';
        const files = Array.isArray(d.files) && d.files.length ? ` (${d.files.join(', ')})` : '';
        get().addToast({ type: 'error', message: msg + files, duration: 8000 });
      }
      return null;
    }
  },
  updateJob: async (jobId, jobPayload) => {
    try {
      const clientId = getClientId();
      const profileId = get().activeProfileId || null;
      const profileDisplayName = getActiveProfileDisplayNameForSnapshot(get);
      const payload = { ...jobPayload, clientId, profileId, profileDisplayName };
      const updated = await api.updateJob(jobId, payload);
      await get().refreshJobs();
      return updated;
    } catch (error) {
      console.error('Failed to update job', error);
      return null;
    }
  },
  runTestCommand: async (commandPayload) => {
    try {
      const clientId = getClientId();
      const profileId = get().activeProfileId || null;
      const profileDisplayName = getActiveProfileDisplayNameForSnapshot(get);
      const payload = { ...commandPayload, clientId, profileId, profileDisplayName };
      const created = await api.runCommand(payload);
      await get().refreshJobs();
      return created;
    } catch (error) {
      console.error('Failed to run test command', error);
      return null;
    }
  },
  startPendingJobs: async () => {
    try {
      const jobs = get().jobs.filter(j => j.status === 'pending');
      const results = await Promise.allSettled(jobs.map((job) => api.startJob(job.id)));
      const fileModified = results.find((r) => r.status === 'rejected' && r.reason?.status === 409 && r.reason?.detail?.code === 'FILE_MODIFIED');
      if (fileModified) {
        const d = fileModified.reason?.detail;
        const msg = d?.message || 'One or more files were modified after upload.';
        const files = Array.isArray(d?.files) && d.files.length ? ` (${d.files.join(', ')})` : '';
        get().addToast({ type: 'error', message: msg + files, duration: 8000 });
      }
      await get().refreshJobs();
      return true;
    } catch (error) {
      console.error('Failed to start pending jobs', error);
      const d = error?.detail;
      if (error?.status === 409 && d?.code === 'FILE_MODIFIED') {
        const msg = d.message || 'One or more files were modified after upload.';
        const files = Array.isArray(d.files) && d.files.length ? ` (${d.files.join(', ')})` : '';
        get().addToast({ type: 'error', message: msg + files, duration: 8000 });
      }
      return false;
    }
  },
  // Start a single pending job by id (used by drag & drop from Pending → Running)
  startJobById: async (jobId) => {
    try {
      const results = await Promise.allSettled([api.startJob(jobId)]);
      const rejected = results.find((r) => r.status === 'rejected');
      if (rejected && rejected.reason?.status === 409 && rejected.reason?.detail?.code === 'FILE_MODIFIED') {
        const d = rejected.reason.detail;
        const msg = d?.message || 'One or more files were modified after upload.';
        const files = Array.isArray(d?.files) && d.files.length ? ` (${d.files.join(', ')})` : '';
        get().addToast({ type: 'error', message: msg + files, duration: 8000 });
      }
      await get().refreshJobs();
      return true;
    } catch (error) {
      console.error('Failed to start job by id', error);
      const d = error?.detail;
      if (error?.status === 409 && d?.code === 'FILE_MODIFIED') {
        const msg = d.message || 'One or more files were modified after upload.';
        const files = Array.isArray(d.files) && d.files.length ? ` (${d.files.join(', ')})` : '';
        get().addToast({ type: 'error', message: msg + files, duration: 8000 });
      }
      return false;
    }
  },
  stopAllJobs: async () => {
    try {
      await api.stopAllJobs();
      await get().refreshJobs();
      return true;
    } catch (error) {
      console.error('Failed to stop all jobs', error);
      return false;
    }
  },
  stopJob: async (jobId) => {
    try {
      await api.stopJob(jobId);
      await get().refreshJobs();
      return true;
    } catch (error) {
      console.error('Failed to stop job', jobId, error);
      return false;
    }
  },
  runBoardBatchAction: async (boardIds, action, params = {}) => {
    try {
      const response = await api.batchBoardActions(boardIds, action, params);
      await get().refreshBoards();
      return response;
    } catch (error) {
      console.error('Failed to run batch board action', error);
      return null;
    }
  },
  moveJobUp: (jobId) => set((state) => {
    const idx = state.jobs.findIndex(j => j.id === jobId);
    if (idx <= 0) return state;
    const jobs = [...state.jobs];
    const [moved] = jobs.splice(idx, 1);
    jobs.splice(idx - 1, 0, moved);
    const newPosition = idx - 1; // 0-based index after move
    void api.reorderJob(jobId, newPosition)
      .then(() => get().refreshJobs())
      .catch((error) => console.error('Failed to reorder job', error));
    return { jobs };
  }),
  moveJobDown: (jobId) => set((state) => {
    const idx = state.jobs.findIndex(j => j.id === jobId);
    if (idx < 0 || idx >= state.jobs.length - 1) return state;
    const jobs = [...state.jobs];
    const [moved] = jobs.splice(idx, 1);
    jobs.splice(idx + 1, 0, moved);
    const newPosition = idx + 1; // 0-based index after move
    void api.reorderJob(jobId, newPosition)
      .then(() => get().refreshJobs())
      .catch((error) => console.error('Failed to reorder job', error));
    return { jobs };
  }),
  /** Move a job to a specific index (e.g. from drag-and-drop). allJobs = current list order. */
  moveJobToIndex: (jobId, toIndex, allJobs) => {
    const jobs = Array.isArray(allJobs) ? [...allJobs] : [...get().jobs];
    const fromIndex = jobs.findIndex(j => j.id === jobId);
    if (fromIndex === -1 || fromIndex === toIndex) return;
    const [moved] = jobs.splice(fromIndex, 1);
    jobs.splice(toIndex, 0, moved);
    set({ jobs });
    void api.reorderJob(jobId, toIndex)
      .then(() => get().refreshJobs())
      .catch((error) => {
        console.error('Failed to reorder job', error);
        get().refreshJobs();
      });
  },
  deleteJob: async (jobId) => {
    try {
      await api.deleteJob(jobId);
      await get().refreshJobs();
      return true;
    } catch (error) {
      console.error('Failed to delete job', error);
      return false;
    }
  },

  /** Create a new batch with only the failed file(s) from a job and start it (moves to Running).
   * @param {string} jobId
   * @param {string[]|null} fileIds - optional: only these file ids (must be failed); null = all failed
   * @param {{ vcd: string, erom?: string, ulp?: string }[]|null} fileSelections - optional: per-file VCD/ERoM/ULP overrides (same order as failedFiles)
   */
  rerunFailedFiles: async (jobId, fileIds = null, fileSelections = null) => {
    try {
      const state = get();
      const job = state.jobs.find(j => j.id === jobId);

      // Frontend-only demo path: when job not found in store (e.g. mock Completed/Failed demo sets)
      if (!job) {
        if (!Array.isArray(fileIds) || fileIds.length === 0) {
          state.addToast({ type: 'warning', message: 'No failed test cases to re-run.' });
          return null;
        }
        const now = new Date().toISOString();
        const files = fileIds.map((id, i) => {
          const sel = Array.isArray(fileSelections) && fileSelections[i] ? fileSelections[i] : {};
          const name = (sel.vcd || `demo_case_${i + 1}`).toString().trim();
          return {
            id: `demo-rerun-file-${Date.now()}-${i}`,
            name,
            order: i + 1,
            status: 'running',
            result: null,
            vcd: sel.vcd || name,
            erom: sel.erom || undefined,
            ulp: sel.ulp || undefined,
          };
        });
        const demoJob = {
          id: `demo-rerun-${Date.now()}`,
          name: 'Demo re-run failed (frontend)',
          status: 'running',
          progress: 0,
          tag: 'Demo',
          configName: 'Demo_re_run',
          totalFiles: files.length,
          completedFiles: 0,
          firmware: files[0]?.erom || 'demo_erom_1.erom',
          boards: ['Demo Board 1'],
          createdAt: now,
          startedAt: now,
          completedAt: null,
          files,
        };

        set({
          jobs: [demoJob, ...state.jobs],
        });
        state.addToast({
          type: 'success',
          message: `Demo re-run started (${files.length} failed test case${files.length > 1 ? 's' : ''}).`,
        });
        return demoJob;
      }

      // Frontend-only demo path: when job is a demo set that already lives in store (id/tag indicates demo)
      if (job && (String(job.id || '').startsWith('demo-') || (job.tag || '').toLowerCase() === 'demo')) {
        const isFailed = (f) => f.result === 'fail' || f.status === 'error';
        const failedFiles = fileIds
          ? job.files.filter(f => fileIds.includes(f.id) && isFailed(f))
          : job.files.filter(isFailed);
        if (failedFiles.length === 0) {
          state.addToast({ type: 'warning', message: 'No failed test cases to re-run.' });
          return null;
        }

        // Update only failed test cases to running, keep others as completed
        const updatedFiles = (job.files || []).map((f) => {
          if (!isFailed(f)) return f;
          if (fileIds && !fileIds.includes(f.id)) return f;
          const idx = failedFiles.findIndex((x) => x.id === f.id);
          const sel = Array.isArray(fileSelections) && fileSelections[idx] ? fileSelections[idx] : {};
          return {
            ...f,
            status: 'running',
            result: null,
            vcd: sel.vcd || f.vcd || f.name,
            erom: sel.erom || f.erom,
            ulp: sel.ulp || f.ulp,
          };
        });

        const updatedJob = {
          ...job,
          status: 'running',
          // keep completed count based on files, progress is visual only
          completedFiles: updatedFiles.filter((f) => f.status === 'completed').length,
          progress: 0,
          files: updatedFiles,
        };

        set({
          jobs: state.jobs.map((j) => (j.id === job.id ? updatedJob : j)),
        });

        state.addToast({
          type: 'success',
          message: `Demo re-run started (${failedFiles.length} failed test case${failedFiles.length > 1 ? 's' : ''}) in this set.`,
        });
        return updatedJob;
      }

      const isFailed = (f) => f.result === 'fail' || f.status === 'error';
      const failedFiles = fileIds
        ? job.files.filter(f => fileIds.includes(f.id) && isFailed(f))
        : job.files.filter(isFailed);
      if (failedFiles.length === 0) {
        state.addToast({ type: 'warning', message: 'No failed test cases to re-run.' });
        return null;
      }
      const filesPayload = failedFiles.map((f, i) => {
        const sel = Array.isArray(fileSelections) && fileSelections[i] ? fileSelections[i] : null;
        const vcdVal = (sel?.vcd ?? f.vcd ?? f.name ?? `test_${i + 1}`).toString().trim() || f.name || `test_${i + 1}`;
        return {
          name: vcdVal,
          order: i + 1,
          vcd: vcdVal,
          erom: (sel?.erom !== undefined && sel?.erom !== '' ? sel.erom : f.erom) ?? undefined,
          ulp: (sel?.ulp !== undefined && sel?.ulp !== '' ? sel.ulp : f.ulp) ?? undefined,
          try_count: f.try_count ?? f.try ?? 1,
        };
      });
      const baseName = (job.configName || job.name || 'Batch').trim();
      const profileId = get().activeProfileId || null;
      const profileDisplayName = getActiveProfileDisplayNameForSnapshot(get);
      const payload = {
        name: `${baseName} (Re-run failed)`,
        tag: job.tag || undefined,
        firmware: job.firmware || '',
        boards: job.boards || [],
        files: filesPayload,
        configName: job.configName || baseName,
        clientId: getClientId(),
        profileId,
        profileDisplayName,
      };
      const created = await api.createJob(payload);
      if (!created || !created.id) {
        state.addToast({ type: 'error', message: 'Failed to create re-run batch.' });
        return null;
      }
      await api.startJob(created.id);
      await get().refreshJobs();
      state.addToast({
        type: 'success',
        message: `Re-run batch created and started (${failedFiles.length} test case${failedFiles.length > 1 ? 's' : ''}).`,
      });
      return created;
    } catch (error) {
      console.error('Failed to re-run failed files', error);
      const d = error?.detail;
      if (error?.status === 409 && d?.code === 'FILE_MODIFIED') {
        const msg = d.message || 'One or more files were modified after upload.';
        const files = Array.isArray(d.files) && d.files.length ? ` (${d.files.join(', ')})` : '';
        get().addToast({ type: 'error', message: msg + files, duration: 8000 });
      } else {
        get().addToast({ type: 'error', message: 'Failed to re-run failed test cases.' });
      }
      return null;
    }
  },

  stopFile: (jobId, fileId) => {
    set((state) => ({
      jobs: state.jobs.map(job =>
        job.id === jobId
          ? {
              ...job,
              files: job.files.map(file =>
                file.id === fileId && file.status === 'running'
                  ? { ...file, status: 'stopped' }
                  : file
              )
            }
          : job
      )
    }));
    void api.stopJobFile(jobId, fileId)
      .then(() => get().refreshJobs())
      .then(() => get().addToast({ type: 'success', message: 'หยุด test case นี้แล้ว' }))
      .catch((error) => {
        console.error('Failed to stop job file', error);
        get().addToast({ type: 'error', message: 'หยุด test case ไม่สำเร็จ' });
      });
  },

  rerunFile: (jobId, fileId) => {
    set((state) => ({
      jobs: state.jobs.map(job =>
        job.id === jobId
          ? {
              ...job,
              files: job.files.map(file =>
                file.id === fileId && file.status === 'stopped'
                  ? { ...file, status: 'pending', result: null }
                  : file
              )
            }
          : job
      )
    }));
    void api.rerunJobFile(jobId, fileId)
      .then(() => get().refreshJobs())
      .then(() => get().addToast({ type: 'success', message: 'sent re-run for this test case' }))
      .catch((error) => {
        console.error('Failed to re-run job file', error);
        get().addToast({ type: 'error', message: 're-run test case failed' });
      });
  },
  
  moveFileUp: (jobId, fileId) => {
    set((state) => {
      const job = state.jobs.find(j => j.id === jobId);
      if (!job) return state;
      
      const files = [...job.files].sort((a, b) => a.order - b.order);
      const fileIndex = files.findIndex(f => f.id === fileId);
      
      if (fileIndex <= 0) return state;
      
      const tempOrder = files[fileIndex].order;
      files[fileIndex].order = files[fileIndex - 1].order;
      files[fileIndex - 1].order = tempOrder;
      
      return {
        jobs: state.jobs.map(j =>
          j.id === jobId ? { ...j, files } : j
        )
      };
    });
    void api.moveJobFile(jobId, fileId, 'up')
      .then(() => get().refreshJobs())
      .catch((error) => console.error('Failed to move job file', error));
  },
  
  moveFileDown: (jobId, fileId) => {
    set((state) => {
      const job = state.jobs.find(j => j.id === jobId);
      if (!job) return state;
      
      const files = [...job.files].sort((a, b) => a.order - b.order);
      const fileIndex = files.findIndex(f => f.id === fileId);
      
      if (fileIndex >= files.length - 1) return state;
      
      const tempOrder = files[fileIndex].order;
      files[fileIndex].order = files[fileIndex + 1].order;
      files[fileIndex + 1].order = tempOrder;
      
      return {
        jobs: state.jobs.map(j =>
          j.id === jobId ? { ...j, files } : j
        )
      };
    });
    void api.moveJobFile(jobId, fileId, 'down')
      .then(() => get().refreshJobs())
      .catch((error) => console.error('Failed to move job file', error));
  },

  // Remove a file from a job (used in Jobs Pending column & Test Cases Progress). Frontend-only for now; does not touch Library or Saved sets.
  deleteJobFile: (jobId, fileId) => {
    set((state) => {
      const job = state.jobs.find((j) => j.id === jobId);
      if (!job) return state;

      const remaining = (job.files || []).filter((f) => f.id !== fileId);
      // Re-number order to be 1..N to keep UI tidy
      const reordered = remaining.map((f, idx) => ({ ...f, order: idx + 1 }));

      return {
        jobs: state.jobs.map((j) =>
          j.id === jobId
            ? {
                ...j,
                files: reordered,
                totalFiles: reordered.length,
              }
            : j
        ),
      };
    });
  },
  
  updateJobTag: (jobId, tag) => {
    const nextTags = tag ? [{ tag: String(tag).trim(), tagColor: null }] : [];
    get().updateJobTags(jobId, nextTags);
  },

  updateJobTags: (jobId, tags) => {
    const normalized = Array.isArray(tags)
      ? tags
          .map((t) => ({
            tag: String(t?.tag ?? t?.name ?? '').trim(),
            tagColor: (t?.tagColor ?? t?.color ?? null) ? String(t?.tagColor ?? t?.color).trim() : null,
          }))
          .filter((t) => t.tag)
      : [];
    const primary = normalized[0] || null;
    set((state) => ({
      jobs: state.jobs.map((j) =>
        j.id === jobId
          ? {
              ...j,
              tags: normalized,
              tag: primary ? primary.tag : null,
              tagColor: primary ? primary.tagColor : null,
            }
          : j
      ),
    }));
    void api
      .updateJobTag(jobId, { tags: normalized, tag: primary ? primary.tag : null, tagColor: primary ? primary.tagColor : null })
      .then((response) => {
        if (response && response.job) {
          set((state) => ({
            jobs: state.jobs.map(j => j.id === jobId ? response.job : j)
          }));
          // Best-effort: keep Set Library tag in sync with System Summary tag edits.
          // We match by set name === job name (unique match only).
          try {
            const jobName = String(response.job?.name || '').trim();
            if (jobName) {
              const sets = get().savedTestCaseSets || [];
              const matches = sets.filter((s) => String(s?.name || '').trim() === jobName);
              if (matches.length === 1) {
                const setId = matches[0].id;
                const rawTag = normalized.map((t) => t.tag).join(', ');
                const tc0 = primary?.tagColor || null;
                const tagColor = tc0 && typeof tc0 === 'string' ? tc0 : (matches[0]?.tagColor || null);
                const tagColorList = normalized.length ? normalized.map((t) => t.tagColor || tagColor || null) : [];
                get().updateSavedTestCaseSet(setId, {
                  tag: rawTag,
                  ...(tagColor != null ? { tagColor } : {}),
                  tagColorList,
                });
              }
            }
          } catch (_e) {
            // ignore
          }
          return;
        }
        return get().refreshJobs();
      })
      .catch((error) => console.error('Failed to update job tag', error));
  },
  
  exportJobToJSON: async (jobId) => {
    try {
      const data = await api.exportJob(jobId);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `job_${jobId}_${new Date().toISOString().split('T')[0]}.json`;
      link.click();
      URL.revokeObjectURL(url);
      return data;
    } catch (error) {
      console.error('Failed to export job', error);
      return null;
    }
  },
  
  // Test Commands Management Actions
  addTestCommand: (command) => set((state) => {
    const newId = Math.max(0, ...state.testCommands.map(c => c.id)) + 1;
    const newCommand = {
      id: newId,
      ...command,
      createdAt: new Date().toISOString()
    };
    const updated = [...state.testCommands, newCommand];
    saveTestCommands(updated);
    return { testCommands: updated };
  }),
  
  updateTestCommand: (id, updates) => set((state) => {
    const updated = state.testCommands.map(cmd => 
      cmd.id === id ? { ...cmd, ...updates, updatedAt: new Date().toISOString() } : cmd
    );
    saveTestCommands(updated);
    return { testCommands: updated };
  }),
  
  deleteTestCommand: (id) => set((state) => {
    const updated = state.testCommands.filter(cmd => cmd.id !== id);
    saveTestCommands(updated);
    return { testCommands: updated };
  }),
  
  duplicateTestCommand: (id) => set((state) => {
    const original = state.testCommands.find(cmd => cmd.id === id);
    if (!original) return state;
    
    const newId = Math.max(0, ...state.testCommands.map(c => c.id)) + 1;
    const duplicated = {
      ...original,
      id: newId,
      name: `${original.name} (Copy)`,
      createdAt: new Date().toISOString()
    };
    const updated = [...state.testCommands, duplicated];
    saveTestCommands(updated);
    return { testCommands: updated };
  }),
  
  exportAllFailedLogs: (jobId) => {
    const state = useTestStore.getState();
    const job = state.jobs.find(j => j.id === jobId);
    if (!job) return;
    
    const failedFiles = (job.files || []).filter(f => f.result === 'fail' || f.status === 'error');
    if (failedFiles.length === 0) {
      alert('No failed or errored files in this job to export logs for.');
      return;
    }
    
    let combinedLogs = `Failed Tests Report - Batch #${jobId}
Generated: ${new Date().toISOString()}
========================================

Batch Information:
- Job ID: ${job.id}
- Job Name: ${job.name || 'N/A'}
- Tag: ${job.tag || 'Untagged'}
- Firmware: ${job.firmware || 'N/A'}
- Boards: ${job.boards?.join(', ') || 'N/A'}
- Started At: ${job.startedAt || 'N/A'}
- Completed At: ${job.completedAt || 'N/A'}
- Total Files: ${job.totalFiles || 0}
- Failed Files: ${failedFiles.length}

========================================
Detailed Error Logs for Failed Test Cases:
========================================
`;
    
    failedFiles.forEach((file, index) => {
      combinedLogs += `\n--- Test Case #${index + 1}: ${file.name || 'N/A'} (ID: ${file.id}) ---\n`;
      combinedLogs += `Order: ${file.order || 'N/A'}\n`;
      combinedLogs += `Status: ${file.status || 'N/A'}\n`;
      combinedLogs += `Result: ${file.result || 'N/A'}\n`;
      combinedLogs += `Error Message: ${file.errorMessage || file.error || 'No specific error message provided.'}\n`;
      combinedLogs += `Completed At: ${file.completedAt || 'N/A'}\n`;
      combinedLogs += `Duration: ${file.duration || 'N/A'}\n`;
      combinedLogs += `\nPossible Causes:\n- Test case logic error\n- Board hardware issue\n- Firmware bug\n- Environmental factors (power, temperature)\n- Communication failure\n`;
      combinedLogs += `Recommendations:\n- Review the test case script/VCD file.\n- Check board logs for more details.\n- Verify board connections and power supply.\n- Try re-running the test on a different board.\n- Consult with hardware/firmware team.\n`;
      combinedLogs += `\n----------------------------------------\n`;
    });
    
    const blob = new Blob([combinedLogs], { type: 'text/plain;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `failed_tests_report_batch_${jobId}_${new Date().toISOString().split('T')[0]}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  }
  };
});
