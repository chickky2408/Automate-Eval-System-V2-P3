/**
 * Resolve file/job owner ids (profile id, legacy client session id, or unknown) to a display name.
 * Client ids (client_*) are mapped via localStorage so we show profile names instead of raw ids.
 */

const CLIENT_OWNER_LABELS_KEY = 'app_client_owner_labels';

const shortOwnerId = (id) => {
  const s = String(id);
  if (s.length <= 18) return s;
  return `${s.slice(0, 8)}…`;
};

function loadClientOwnerLabels() {
  try {
    const raw = localStorage.getItem(CLIENT_OWNER_LABELS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveClientOwnerLabels(map) {
  try {
    localStorage.setItem(CLIENT_OWNER_LABELS_KEY, JSON.stringify(map));
  } catch {
    // ignore quota
  }
}

/** Remember that this browser client id was used with this display name (profile name). */
export function rememberClientOwnerLabel(clientId, displayName) {
  const id = String(clientId || '').trim();
  const name = String(displayName || '').trim();
  if (!id || !name || !id.startsWith('client_')) return;
  const map = loadClientOwnerLabels();
  if (map[id] === name) return;
  map[id] = name;
  saveClientOwnerLabels(map);
}

export function getStoredClientOwnerLabel(clientId) {
  const id = String(clientId || '').trim();
  if (!id) return null;
  const map = loadClientOwnerLabels();
  return map[id] || null;
}

/**
 * Learn clientId → profile name from jobs that carry both clientId and profileId (API).
 */
export function syncOwnerLabelsFromJobs(jobs, profiles = [], sharedProfiles = [], serverProfileDirectory = []) {
  if (!Array.isArray(jobs) || !jobs.length) return;
  const nameForProfile = (pid) => {
    if (!pid) return null;
    const p = profiles.find((x) => x.id === pid);
    if (p?.name) return p.name;
    const s = sharedProfiles.find((x) => x.id === pid);
    if (s?.name) return s.name;
    const srv = serverProfileDirectory.find((x) => x.id === pid);
    if (srv?.name) return srv.name;
    return null;
  };
  jobs.forEach((j) => {
    const cid = j.clientId ?? j.client_id;
    const pid = j.profileId ?? j.profile_id;
    const pname = j.profileName ?? j.profile_name;
    if (!cid || typeof cid !== 'string' || !cid.startsWith('client_')) return;
    const name = (pname && String(pname).trim()) || nameForProfile(pid);
    if (name) rememberClientOwnerLabel(cid, name);
  });
}

/** Learn clientId → display name from file rows (API ownerName or snapshot). */
export function syncOwnerLabelsFromFiles(files) {
  if (!Array.isArray(files) || !files.length) return;
  files.forEach((f) => {
    const cid = f.ownerId ?? f.owner_id;
    const name = f.ownerName ?? f.owner_name;
    if (!cid || typeof cid !== 'string' || !cid.startsWith('client_')) return;
    const n = name != null && String(name).trim();
    if (n) rememberClientOwnerLabel(cid, n);
  });
}

/**
 * @param {string|null|undefined} ownerId
 * @param {{ profiles?: {id:string,name?:string}[], sharedProfiles?: {id:string,name?:string}[], serverProfileDirectory?: {id:string,name?:string}[], activeProfileId?: string, activeProfileName?: string, currentClientId?: string }} ctx
 */
export function resolveOwnerDisplayName(ownerId, ctx = {}) {
  if (ownerId == null || ownerId === '') return '—';
  const id = String(ownerId);
  const {
    profiles = [],
    sharedProfiles = [],
    serverProfileDirectory = [],
    activeProfileId,
    activeProfileName,
    currentClientId,
  } = ctx;

  const fromLocal = profiles.find((p) => p.id === id);
  if (fromLocal?.name) return fromLocal.name;

  const fromShared = sharedProfiles.find((p) => p.id === id);
  if (fromShared?.name) return fromShared.name;

  const fromServer = serverProfileDirectory.find((p) => p.id === id);
  if (fromServer?.name) return fromServer.name;

  if (id.startsWith('client_')) {
    if (currentClientId && id === currentClientId && activeProfileName) {
      return activeProfileName;
    }
    const stored = getStoredClientOwnerLabel(id);
    if (stored) return stored;
  }

  if (id === activeProfileId && activeProfileName) return activeProfileName;
  if (currentClientId && id === currentClientId) {
    return activeProfileName || shortOwnerId(id);
  }

  return shortOwnerId(id);
}

/**
 * Job objects may include profileName from API (authoritative, same for all users) or profileId for fallback.
 */
export function resolveJobOwnerDisplayName(job, ctx = {}) {
  if (!job) return '—';
  const pn = job.profileName ?? job.profile_name;
  if (pn != null && String(pn).trim() !== '') return String(pn).trim();

  const pid = job.profileId ?? job.profile_id;
  if (pid) {
    const n = resolveOwnerDisplayName(pid, ctx);
    if (n !== '—') return n;
  }
  if (job.clientId && ctx.currentClientId && job.clientId === ctx.currentClientId) {
    return ctx.activeProfileName || resolveOwnerDisplayName(ctx.activeProfileId, ctx);
  }
  if (job.clientId) {
    return resolveOwnerDisplayName(job.clientId, ctx);
  }
  return '—';
}

/**
 * File rows may include ownerName from API (same for all clients) or ownerId for fallback.
 */
export function resolveFileOwnerDisplay(file, ctx = {}) {
  if (!file) return '—';
  const on = file.ownerName ?? file.owner_name;
  if (on != null && String(on).trim() !== '') return String(on).trim();
  return resolveOwnerDisplayName(file.ownerId ?? file.owner_id, ctx);
}

export function isFileOwnerMine(file, currentClientId, activeProfileId) {
  const o = file?.ownerId ?? file?.owner_id;
  if (o == null || o === '') return true;
  if (currentClientId && o === currentClientId) return true;
  if (activeProfileId && o === activeProfileId) return true;
  return false;
}

export function isFileOwnerOtherUser(file, currentClientId, activeProfileId) {
  return !isFileOwnerMine(file, currentClientId, activeProfileId);
}
