/**
 * Helpers for "replace library file" warnings when the user chooses Upload new
 * over Reuse. Aligns with File Library reference logic (basename-normalized).
 */

const normBasename = (v) => String(v || '').split('/').pop().trim().toLowerCase();

/** Saved job names that reference this file (snapshot or TC items). */
export function getSetNamesUsingFile(fileName, savedTestCaseSets) {
  if (!fileName || !savedTestCaseSets?.length) return [];
  const fNorm = normBasename(fileName);
  const names = [];
  for (const set of savedTestCaseSets) {
    const hasInSnapshot = set.fileLibrarySnapshot?.some((s) => normBasename(s?.name) === fNorm);
    const hasInItems = (set.items || []).some(
      (t) =>
        normBasename(t?.vcdName) === fNorm ||
        normBasename(t?.binName) === fNorm ||
        normBasename(t?.linName) === fNorm
    );
    if (hasInSnapshot || hasInItems) names.push(set.name || set.id);
  }
  return names;
}

/** Each { name, set } — set is job name or "Current (from table)" marker. */
export function getTestCasesUsingFile(fileName, savedTestCases, savedTestCaseSets) {
  if (!fileName) return [];
  const fNorm = normBasename(fileName);
  const out = [];
  const isUsedInTc = (tc) => {
    if (normBasename(tc?.vcdName) === fNorm || normBasename(tc?.binName) === fNorm || normBasename(tc?.linName) === fNorm) {
      return true;
    }
    const cmds = Array.isArray(tc.commands) ? tc.commands : [];
    if (cmds.some((c) => c && normBasename(c?.file) === fNorm)) return true;
    const extra = tc.extraColumns && typeof tc.extraColumns === 'object' ? tc.extraColumns : {};
    return Object.values(extra).some((v) => normBasename(v) === fNorm);
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
}

/**
 * Fallback references from Jobs list (global), when profile snapshots miss links.
 */
export function getJobRefsUsingFile(fileName, jobs) {
  if (!fileName) return { usedByTcs: [], setNames: [] };
  const fNorm = normBasename(fileName);
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
      const vcd = normBasename(f?.vcd || f?.name);
      const erom = normBasename(f?.erom);
      const ulp = normBasename(f?.ulp);
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
}

const STATUS_PRIORITY = { completed: 1, error: 2, pending: 3, running: 4 };

function normalizeJobStatusForLibrary(status) {
  const s = (status || '').toLowerCase();
  if (s === 'running' || s === 'pending') return s;
  if (s === 'completed' || s === 'stopped') return 'completed';
  if (s === 'error') return 'error';
  return null;
}

function isJobFileFailed(f) {
  return f?.result === 'fail' || String(f?.status || '').toLowerCase() === 'error';
}

/** Map saved job display name → strongest status seen on `jobs` (same as File Library). */
export function buildSetJobStatusByName(jobs) {
  const map = new Map();
  (jobs || []).forEach((job) => {
    const status = normalizeJobStatusForLibrary(job.status);
    if (!status) return;
    const setName = String(job.configName || job.name || '').trim();
    if (!setName) return;
    const jobHasFail = (job.files || []).some(isJobFileFailed);
    const setLevelStatus = status === 'completed' && jobHasFail ? 'error' : status;
    const current = map.get(setName);
    if (!current || STATUS_PRIORITY[setLevelStatus] > STATUS_PRIORITY[current]) {
      map.set(setName, setLevelStatus);
    }
  });
  return map;
}

export function getSetJobStatusPillClass(status) {
  if (status === 'running') {
    return 'bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-900/35 dark:text-blue-200 dark:border-blue-600';
  }
  if (status === 'pending') {
    return 'bg-amber-50 text-amber-900 border-amber-200 dark:bg-amber-900/30 dark:text-amber-200 dark:border-amber-700';
  }
  if (status === 'error') {
    return 'bg-red-50 text-red-700 border-red-300 dark:bg-red-900/35 dark:text-red-300 dark:border-red-700/60';
  }
  if (status === 'completed') {
    return 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-900/25 dark:text-emerald-300 dark:border-emerald-700';
  }
  return 'bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-800/80 dark:text-slate-400 dark:border-slate-600';
}

function pushUnique(lowerSet, list, value) {
  const s = String(value || '').trim();
  if (!s) return;
  const k = s.toLowerCase();
  if (lowerSet.has(k)) return;
  lowerSet.add(k);
  list.push(s);
}

/**
 * @param {string} libraryFileName — name of the existing library row (references use this)
 * @param {{ savedTestCases?: any[], savedTestCaseSets?: any[], jobs?: any[], extraTestCaseLists?: any[][] }} ctx
 */
export function buildLibraryFileReplaceImpact(libraryFileName, ctx) {
  const {
    savedTestCases = [],
    savedTestCaseSets = [],
    jobs = [],
    extraTestCaseLists = [],
  } = ctx || {};

  const mergedTcs = [...(savedTestCases || [])];
  (extraTestCaseLists || []).forEach((list) => {
    (list || []).forEach((tc) => mergedTcs.push(tc));
  });

  const tcUsages = getTestCasesUsingFile(libraryFileName, mergedTcs, savedTestCaseSets);
  const setNamesFromLib = getSetNamesUsingFile(libraryFileName, savedTestCaseSets) || [];
  const jobRefs = getJobRefsUsingFile(libraryFileName, jobs);

  const nameKey = new Set();
  const allJobNames = [];
  setNamesFromLib.forEach((n) => pushUnique(nameKey, allJobNames, n));
  (jobRefs.setNames || []).forEach((n) => pushUnique(nameKey, allJobNames, n));

  const setStatusByName = buildSetJobStatusByName(jobs);
  const jobRows = allJobNames.map((name) => ({
    name,
    status: setStatusByName.get(name) || null,
  }));

  const hasRunningOrPending = jobRows.some((r) => r.status === 'running' || r.status === 'pending');
  const hasCompleted = jobRows.some((r) => r.status === 'completed');
  const hasError = jobRows.some((r) => r.status === 'error');

  const tcRows = [];
  const seenTc = new Set();
  tcUsages.forEach((u) => {
    const key = `${String(u.name || '').toLowerCase()}|${String(u.set || '').toLowerCase()}`;
    if (seenTc.has(key)) return;
    seenTc.add(key);
    tcRows.push({ name: u.name, context: u.set || '' });
  });

  const queueTcRows = [];
  (jobRefs.usedByTcs || []).forEach((u) => {
    const key = `${String(u.name || '').toLowerCase()}|${String(u.set || '').toLowerCase()}`;
    if (seenTc.has(key)) return;
    seenTc.add(key);
    queueTcRows.push({ name: u.name, jobName: u.set || '' });
  });

  const hasAnyUsage = tcRows.length > 0 || jobRows.length > 0 || queueTcRows.length > 0;

  return {
    libraryFileName,
    tcRows,
    queueTcRows,
    jobRows,
    hasRunningOrPending,
    hasCompleted,
    hasError,
    hasAnyUsage,
    needsConfirmAck: hasAnyUsage,
  };
}
