/**
 * Shared tag pill colors (Tailwind class bundles, light + dark).
 * Keys are stored in extraColumns.tagColor (default) and tagColorList[i] (per tag).
 */

/** Max characters per tag token (comma-separated). Keep in sync with backend `MAX_TAG_CHAR_LENGTH`. */
export const MAX_TAG_CHAR_LENGTH = 10;

/** Trim and clamp one tag label for storage/display. */
export function clampTagLabel(t) {
  const s = String(t ?? '').trim();
  if (!s) return '';
  return s.slice(0, MAX_TAG_CHAR_LENGTH);
}

export const TAG_PALETTE_MAP = {
  mint: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-200 dark:border-emerald-700',
  emerald: 'bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-100 dark:border-emerald-600',
  green: 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-200 dark:border-green-700',
  lime: 'bg-lime-100 text-lime-900 border-lime-200 dark:bg-lime-900/25 dark:text-lime-100 dark:border-lime-700',
  yellow: 'bg-yellow-100 text-yellow-900 border-yellow-200 dark:bg-yellow-900/25 dark:text-yellow-100 dark:border-yellow-700',
  amber: 'bg-amber-100 text-amber-900 border-amber-200 dark:bg-amber-900/30 dark:text-amber-200 dark:border-amber-700',
  orange: 'bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-900/30 dark:text-orange-200 dark:border-orange-700',
  red: 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-200 dark:border-red-700',
  rose: 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-900/30 dark:text-rose-200 dark:border-rose-700',
  pink: 'bg-pink-100 text-pink-800 border-pink-200 dark:bg-pink-900/30 dark:text-pink-200 dark:border-pink-700',
  fuchsia: 'bg-fuchsia-100 text-fuchsia-800 border-fuchsia-200 dark:bg-fuchsia-900/30 dark:text-fuchsia-200 dark:border-fuchsia-700',
  violet: 'bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-900/30 dark:text-violet-200 dark:border-violet-700',
  purple: 'bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/30 dark:text-purple-200 dark:border-purple-700',
  indigo: 'bg-indigo-100 text-indigo-800 border-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-200 dark:border-indigo-700',
  blue: 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-200 dark:border-blue-700',
  sky: 'bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-900/30 dark:text-sky-200 dark:border-sky-700',
  cyan: 'bg-cyan-100 text-cyan-800 border-cyan-200 dark:bg-cyan-900/30 dark:text-cyan-200 dark:border-cyan-700',
  teal: 'bg-teal-100 text-teal-800 border-teal-200 dark:bg-teal-900/30 dark:text-teal-200 dark:border-teal-700',
  slate: 'bg-slate-100 text-slate-800 border-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600',
  gray: 'bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-600',
  zinc: 'bg-zinc-100 text-zinc-800 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:border-zinc-600',
  neutral: 'bg-neutral-100 text-neutral-800 border-neutral-200 dark:bg-neutral-800 dark:text-neutral-200 dark:border-neutral-600',
  stone: 'bg-stone-100 text-stone-800 border-stone-200 dark:bg-stone-800 dark:text-stone-200 dark:border-stone-600',
  // extra distinct hues
  crimson: 'bg-red-50 text-red-950 border-red-300 dark:bg-red-950/40 dark:text-red-100 dark:border-red-600',
  coral: 'bg-orange-50 text-orange-950 border-orange-300 dark:bg-orange-950/35 dark:text-orange-100 dark:border-orange-600',
  gold: 'bg-amber-50 text-amber-950 border-amber-300 dark:bg-amber-950/35 dark:text-amber-100 dark:border-amber-600',
  olive: 'bg-lime-50 text-lime-950 border-lime-300 dark:bg-lime-950/30 dark:text-lime-100 dark:border-lime-600',
  ocean: 'bg-cyan-50 text-cyan-950 border-cyan-300 dark:bg-cyan-950/35 dark:text-cyan-100 dark:border-cyan-600',
  royal: 'bg-indigo-50 text-indigo-950 border-indigo-300 dark:bg-indigo-950/40 dark:text-indigo-100 dark:border-indigo-600',
  plum: 'bg-purple-50 text-purple-950 border-purple-300 dark:bg-purple-950/40 dark:text-purple-100 dark:border-purple-600',
  berry: 'bg-pink-50 text-pink-950 border-pink-300 dark:bg-pink-950/35 dark:text-pink-100 dark:border-pink-600',
};

export const TAG_PALETTE_KEYS = Object.keys(TAG_PALETTE_MAP);

/** Solid Tailwind bg classes for small round swatches (picker preview). */
export const TAG_SWATCH_DOT_CLASS = {
  mint: 'bg-emerald-500',
  emerald: 'bg-emerald-600',
  green: 'bg-green-500',
  lime: 'bg-lime-500',
  yellow: 'bg-yellow-400',
  amber: 'bg-amber-500',
  orange: 'bg-orange-500',
  red: 'bg-red-500',
  rose: 'bg-rose-500',
  pink: 'bg-pink-500',
  fuchsia: 'bg-fuchsia-500',
  violet: 'bg-violet-500',
  purple: 'bg-purple-500',
  indigo: 'bg-indigo-500',
  blue: 'bg-blue-500',
  sky: 'bg-sky-500',
  cyan: 'bg-cyan-500',
  teal: 'bg-teal-500',
  slate: 'bg-slate-500',
  gray: 'bg-gray-500',
  zinc: 'bg-zinc-500',
  neutral: 'bg-neutral-500',
  stone: 'bg-stone-500',
  crimson: 'bg-red-700',
  coral: 'bg-orange-400',
  gold: 'bg-amber-400',
  olive: 'bg-lime-600',
  ocean: 'bg-cyan-600',
  royal: 'bg-indigo-600',
  plum: 'bg-purple-600',
  berry: 'bg-pink-600',
};

export function isValidPaletteKey(key) {
  return Boolean(key && TAG_PALETTE_MAP[key]);
}

/**
 * Canonical palette key for any stored tag color string (case-insensitive).
 * Unknown values become `mint` so filters and swatches stay aligned across System Summary, Set Library, and tag editors.
 */
export function normalizeTagColorKey(k) {
  const s = String(k ?? '')
    .trim()
    .toLowerCase();
  if (!s) return 'mint';
  return TAG_PALETTE_MAP[s] ? s : 'mint';
}

/**
 * Primary tag color for job rows (first entry in `job.tags`, then legacy `tagColor` / `tag_color`).
 */
export function getJobPrimaryTagColorKey(job) {
  if (!job) return 'mint';
  const tags = Array.isArray(job.tags) ? job.tags : [];
  if (tags.length > 0) {
    const t0 = tags[0];
    const c = t0?.tagColor ?? t0?.color ?? null;
    if (c != null && String(c).trim() !== '') return normalizeTagColorKey(c);
  }
  return normalizeTagColorKey(job.tagColor ?? job.tag_color ?? 'mint');
}

/**
 * True if a job has the selected tag color in ANY tag (multi-tag aware).
 * Includes legacy `job.tagColor` / `job.tag_color` as fallback.
 */
export function jobHasAnyTagColor(job, selectedColorKey) {
  if (!selectedColorKey) return true;
  const want = normalizeTagColorKey(selectedColorKey);
  if (!job) return false;

  const colors = new Set();
  const tags = Array.isArray(job.tags) ? job.tags : [];
  for (const t of tags) {
    const c = t?.tagColor ?? t?.color ?? null;
    if (c == null) continue;
    const k = normalizeTagColorKey(c);
    if (k) colors.add(k);
  }
  colors.add(normalizeTagColorKey(job.tagColor ?? job.tag_color ?? 'mint'));

  return colors.has(want);
}

/**
 * Saved / draft test case row — true if any tag pill uses `selectedColorKey` (multi-tag via tagColorList).
 * Rows with no tags match only `mint`.
 */
export function testCaseHasAnyTagColor(tc, selectedColorKey) {
  if (!selectedColorKey || !TAG_PALETTE_MAP[selectedColorKey]) return true;
  const want = normalizeTagColorKey(selectedColorKey);
  const ex = tc?.extraColumns && typeof tc.extraColumns === 'object' ? tc.extraColumns : {};
  const raw = String(ex.tag || ex.Tag || '').trim();
  const parts = splitTagsComma(raw);
  if (!parts.length) {
    return want === normalizeTagColorKey('mint');
  }
  const colorList = normalizeTagColorList(ex, parts.length);
  return colorList.some((k) => normalizeTagColorKey(k) === want);
}

/**
 * Library file row (picker / filters) — matches when file tag styling uses the selected palette key.
 * Uses `fileTagColors[id]`, optional `file.tagColor`, and optional per-tag `tagColorList` on the file row.
 */
export function libraryFileRowMatchesTagColorFilter(file, fileTags, fileTagColors, selectedColorKey) {
  if (!selectedColorKey || !TAG_PALETTE_MAP[selectedColorKey]) return true;
  const want = normalizeTagColorKey(selectedColorKey);
  const fid = file?.id;
  const tagVal = String(
    (fileTags && fid != null && (fileTags[String(fid)] ?? fileTags[fid])) || ''
  ).trim();
  const parts = splitTagsComma(tagVal);
  const fromMap =
    fid != null ? fileTagColors?.[String(fid)] ?? fileTagColors?.[fid] : undefined;
  const mapStr =
    fromMap !== undefined && fromMap !== null && String(fromMap).trim() !== '' ? String(fromMap).trim() : null;
  const fromRow = file?.tagColor ?? file?.tag_color;
  const rowStr =
    fromRow !== undefined && fromRow !== null && String(fromRow).trim() !== '' ? String(fromRow).trim() : null;
  const list = Array.isArray(file?.tagColorList)
    ? file.tagColorList
    : Array.isArray(file?.tag_color_list)
      ? file.tag_color_list
      : null;
  if (!parts.length) {
    return want === normalizeTagColorKey(mapStr ?? rowStr ?? '');
  }
  // Same precedence as `resolveFileLibraryRowTagColorKey` (store / row wins over API tagColorList).
  // Otherwise server default lists (e.g. mint) hide client `fileTagColors` and the Files tab filter breaks.
  if (mapStr) {
    return normalizeTagColorKey(mapStr) === want;
  }
  if (rowStr) {
    return normalizeTagColorKey(rowStr) === want;
  }
  if (list && list.length) {
    const keys = parts.map((_, i) => normalizeTagColorKey(list[i] ?? 'mint'));
    return keys.some((k) => k === want);
  }
  return want === normalizeTagColorKey('mint');
}

export function splitTagsComma(raw) {
  return String(raw || '')
    .split(',')
    .map((t) => clampTagLabel(t))
    .filter(Boolean);
}

/** Normalize a full comma-separated tag string (clamp each token, join with ', '). */
export function normalizeCommaTagString(raw) {
  const parts = splitTagsComma(raw);
  return parts.length ? parts.join(', ') : '';
}

/** Align tagColorList length with comma-separated tags; fill from tagColor default. */
export function syncTagColorListAfterTagChange(nextExtra, newTagString) {
  const tags = splitTagsComma(newTagString);
  const fbRaw = nextExtra.tagColor || nextExtra.tag_color || 'mint';
  const safeFb = TAG_PALETTE_MAP[fbRaw] ? fbRaw : 'mint';
  const prev = Array.isArray(nextExtra.tagColorList) ? nextExtra.tagColorList : [];
  if (tags.length === 0) {
    delete nextExtra.tagColorList;
    return;
  }
  nextExtra.tagColorList = tags.map((_, i) => {
    const k = prev[i];
    return TAG_PALETTE_MAP[k] ? k : safeFb;
  });
}

export function normalizeTagColorList(extra, tagCount) {
  const fbRaw = extra?.tagColor || extra?.tag_color || 'mint';
  const safeFb = TAG_PALETTE_MAP[fbRaw] ? fbRaw : 'mint';
  const raw = Array.isArray(extra?.tagColorList) ? extra.tagColorList : [];
  return Array.from({ length: tagCount }, (_, i) => {
    const k = raw[i];
    return TAG_PALETTE_MAP[k] ? k : safeFb;
  });
}

export function getFirstTagPillClass(extra, rawTagString) {
  const tags = splitTagsComma(rawTagString);
  if (!tags.length) return TAG_PALETTE_MAP.mint;
  const list = normalizeTagColorList(extra, tags.length);
  return TAG_PALETTE_MAP[list[0]] || TAG_PALETTE_MAP.mint;
}

export function formatPaletteOptionLabel(key) {
  if (!key) return '';
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/**
 * `extraColumns` keys that are app metadata (tag UI, per-tag colors, row lock), not user CSV columns.
 * Use when building dynamic table columns from `Object.keys(extraColumns)`.
 */
export function isExtraColumnHiddenFromLibraryTable(col) {
  if (!col || typeof col !== 'string') return true;
  if (/^vis$/i.test(col)) return true;
  if (/^tag(color)?$/i.test(col)) return true;
  if (/^tagColorList$/i.test(col)) return true;
  if (/^tag_color$/i.test(col)) return true;
  return false;
}

/** Tailwind class bundle for job/batch tag pills (API field `tagColor`). */
export function jobTagPillClasses(tagColor) {
  const k = isValidPaletteKey(tagColor) ? tagColor : 'mint';
  return TAG_PALETTE_MAP[k] || TAG_PALETTE_MAP.mint;
}
