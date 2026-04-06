/**
 * API Service Layer
 * 
 * This service handles all API communication with the backend.
 * Backend developers should implement these endpoints according to the specifications below.
 * 
 * All functions return Promises that resolve with the response data or reject with an error.
 */

import API_ENDPOINTS from '../utils/apiEndpoints';

// Helper function for making API requests
const apiRequest = async (endpoint, options = {}) => {
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const defaultOptions = {
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      // Add authentication token if available
      ...(localStorage.getItem('authToken') && {
        'Authorization': `Bearer ${localStorage.getItem('authToken')}`
      })
    },
  };

  const config = {
    ...defaultOptions,
    ...options,
    headers: {
      ...defaultOptions.headers,
      ...options.headers,
    },
  };
  if (isFormData && config.headers['Content-Type']) {
    delete config.headers['Content-Type'];
  }

  try {
    const response = await fetch(endpoint, config);
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: response.statusText }));
      const err = new Error(errorData.detail || errorData.message || `HTTP error! status: ${response.status}`);
      err.status = response.status;
      err.detail = errorData.detail || errorData.message;
      throw err;
    }
    
    return await response.json();
  } catch (error) {
    console.error('API Request Error:', error);
    throw error;
  }
};

// ============================================
// SYSTEM HEALTH APIs
// ============================================

/**
 * Health check (short)
 * Expected Response: { status, version }
 */
export const getHealth = () => apiRequest(API_ENDPOINTS.HEALTH);

/**
 * Get system health summary
 * Expected Response: { totalBoards, onlineBoards, busyBoards, errorBoards, storageUsage, storageTotal, storageUsed, boardApiStatus }
 */
export const getSystemHealth = () => apiRequest(API_ENDPOINTS.SYSTEM_HEALTH);

/**
 * Get storage status
 * Expected Response: { usage, total, used, percentage }
 */
export const getStorageStatus = () => apiRequest(API_ENDPOINTS.STORAGE_STATUS);

/**
 * Get Board REST API status
 * Expected Response: { status, message, timestamp }
 */
export const getBoardApiStatus = () => apiRequest(API_ENDPOINTS.BOARD_API_STATUS);

/**
 * Get MQTT broker status
 * Expected Response: { status: 'online' | 'offline', lastConnected, messageCount }
 */
export const getMqttStatus = () => apiRequest(API_ENDPOINTS.MQTT_STATUS);

// ============================================
// BOARDS/DEVICES APIs
// ============================================

/**
 * Get all boards
 * Query params: ?status=online&model=STM32&firmware=v2.3.1
 * Expected Response: Array of board objects
 */
export const getBoards = (filters = {}) => {
  const queryParams = new URLSearchParams(filters).toString();
  const url = queryParams ? `${API_ENDPOINTS.BOARDS}?${queryParams}` : API_ENDPOINTS.BOARDS;
  return apiRequest(url);
};

/**
 * Get board by ID
 * Expected Response: Board object with full details
 */
export const getBoardById = (id) => apiRequest(API_ENDPOINTS.BOARD_BY_ID(id));

/**
 * Create board
 * Body: { name, status, ip, mac, firmware, model, tag, connections }
 */
export const createBoard = (payload) => {
  return apiRequest(API_ENDPOINTS.BOARD_CREATE, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
};

/**
 * Update board
 * Body: { name?, status?, ip?, mac?, firmware?, model?, tag?, connections? }
 */
export const updateBoard = (id, payload) => {
  return apiRequest(API_ENDPOINTS.BOARD_UPDATE(id), {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
};

/**
 * Delete board
 */
export const deleteBoard = (id) => {
  return apiRequest(API_ENDPOINTS.BOARD_DELETE(id), { method: 'DELETE' });
};

/**
 * Get board status (detailed)
 * Expected Response: Board status object
 */
export const getBoardStatus = (id) => apiRequest(API_ENDPOINTS.BOARD_STATUS(id));

/**
 * Get board telemetry data
 * Expected Response: { voltage, signal, temp, timestamp }
 */
export const getBoardTelemetry = (id) => apiRequest(API_ENDPOINTS.BOARD_TELEMETRY(id));

/**
 * Reboot a board
 * Expected Response: { success: true, message: string }
 */
export const rebootBoard = (id) => apiRequest(API_ENDPOINTS.BOARD_REBOOT(id), { method: 'POST' });

/**
 * Shutdown board (frontend ready; backend may not implement yet)
 */
export const shutdownBoard = (id) => apiRequest(API_ENDPOINTS.BOARD_SHUTDOWN(id), { method: 'POST' });

/**
 * Pause queue for board (frontend ready; backend may not implement yet)
 */
export const pauseBoardQueue = (id) => apiRequest(API_ENDPOINTS.BOARD_PAUSE_QUEUE(id), { method: 'POST' });

/**
 * Resume queue for board (frontend ready; backend may not implement yet)
 */
export const resumeBoardQueue = (id) => apiRequest(API_ENDPOINTS.BOARD_RESUME_QUEUE(id), { method: 'POST' });

/**
 * Update board firmware
 * Body: { firmwareVersion: string, firmwareFile: File }
 * Expected Response: { success: true, message: string }
 */
export const updateBoardFirmware = (id, firmwareVersion, firmwareFile) => {
  const formData = new FormData();
  formData.append('firmwareVersion', firmwareVersion);
  formData.append('firmwareFile', firmwareFile);
  
  return apiRequest(API_ENDPOINTS.BOARD_UPDATE_FIRMWARE(id), {
    method: 'POST',
    headers: {}, // Let browser set Content-Type for FormData
    body: formData,
  });
};

/**
 * Run self-test on board
 * Expected Response: { success: true, results: object }
 */
export const runBoardSelfTest = (id) => apiRequest(API_ENDPOINTS.BOARD_SELF_TEST(id), { method: 'POST' });

/**
 * Batch actions on multiple boards
 * Body: { boardIds: number[], action: 'reboot' | 'updateFirmware' | 'selfTest', ...additionalParams }
 * Expected Response: { success: true, results: Array }
 */
export const batchBoardActions = (boardIds, action, params = {}) => {
  return apiRequest(API_ENDPOINTS.BOARD_BATCH_ACTIONS, {
    method: 'POST',
    body: JSON.stringify({ boardIds, action, ...params }),
  });
};

/**
 * Connect to board via SSH (WebSocket)
 * Returns WebSocket connection URL (ws://)
 */
export const getBoardSSHConnection = (id) => {
  const base = API_ENDPOINTS.BOARD_SSH_WS ? API_ENDPOINTS.BOARD_SSH_WS(id) : API_ENDPOINTS.BOARD_SSH_CONNECT(id).replace(/^http/, 'ws');
  const token = localStorage.getItem('authToken') || '';
  return token ? `${base}?token=${token}` : base;
};

// ============================================
// JOBS/BATCHES APIs
// ============================================

/**
 * Get all jobs
 * Query params: ?status=running&tag=Team A&clientId=xxx
 * Expected Response: Array of job objects
 */
export const getJobs = (filters = {}) => {
  const queryParams = new URLSearchParams(filters).toString();
  const url = queryParams ? `${API_ENDPOINTS.JOBS}?${queryParams}` : API_ENDPOINTS.JOBS;
  return apiRequest(url);
};

/**
 * Get job by ID
 * Expected Response: Job object with full details including files
 */
export const getJobById = (id) => apiRequest(API_ENDPOINTS.JOB_BY_ID(id));

/**
 * Create a new job/batch
 * Body: { name, tag, firmware, boards, files: [{ name, order, ... }], configName }
 * Expected Response: { id, ...jobData }
 */
export const createJob = (jobData) => {
  return apiRequest(API_ENDPOINTS.JOB_CREATE, {
    method: 'POST',
    body: JSON.stringify(jobData),
  });
};

/**
 * Update an existing job/batch (pending only). Same body shape as createJob.
 * Expected Response: { id, ...jobData }
 */
export const updateJob = (jobId, jobData) => {
  return apiRequest(API_ENDPOINTS.JOB_BY_ID(jobId), {
    method: 'PUT',
    body: JSON.stringify(jobData),
  });
};

/**
 * Start a job
 * Expected Response: { success: true, message: string }
 */
export const startJob = (id) => apiRequest(API_ENDPOINTS.JOB_START(id), { method: 'POST' });

/**
 * Stop a job
 * Expected Response: { success: true, message: string }
 */
export const stopJob = (id) => apiRequest(API_ENDPOINTS.JOB_STOP(id), { method: 'POST' });

/**
 * Stop all running jobs
 * Expected Response: { success: true, stoppedCount: number }
 */
export const stopAllJobs = () => apiRequest(API_ENDPOINTS.JOB_STOP_ALL, { method: 'POST' });

/**
 * Export job to JSON
 * Expected Response: JSON file download or JSON data
 */
export const exportJob = (id) => apiRequest(API_ENDPOINTS.JOB_EXPORT(id));

/**
 * Run test command
 * Body: { name?, command, tag?, boards?, configName?, firmware?, clientId? }
 */
export const runCommand = (payload) => {
  return apiRequest(API_ENDPOINTS.JOB_RUN_COMMAND, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
};

/**
 * Reorder job in queue
 * Query param: new_position
 * Expected Response: { message: string }
 */
export const reorderJob = (id, newPosition) => {
  const url = `${API_ENDPOINTS.JOB_REORDER(id)}?new_position=${newPosition}`;
  return apiRequest(url, { method: 'POST' });
};

/**
 * Update job tag (and optionally tag color).
 * Pass a string for tag only, or { tag?, tagColor? } for partial updates.
 * Expected Response: { success: true, job: updatedJob }
 */
export const updateJobTag = (id, tagOrPayload) => {
  const body =
    tagOrPayload !== null &&
    typeof tagOrPayload === 'object' &&
    !Array.isArray(tagOrPayload)
      ? tagOrPayload
      : { tag: tagOrPayload ?? null };
  return apiRequest(API_ENDPOINTS.JOB_BY_ID(id), {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
};

/**
 * Delete a job/batch
 * Expected Response: { message: string }
 */
export const deleteJob = (id) => {
  return apiRequest(API_ENDPOINTS.JOB_DELETE(id), {
    method: 'DELETE',
  });
};

/**
 * Upload files and create job
 * Body: FormData (files + optional metadata)
 * Expected Response: { id, ...jobData }
 */
export const uploadJob = (formData) => {
  return apiRequest(API_ENDPOINTS.JOB_UPLOAD, {
    method: 'POST',
    headers: {},
    body: formData,
  });
};

/**
 * Start queue processing
 * Expected Response: { success, message }
 */
export const startJobQueue = () => apiRequest(API_ENDPOINTS.JOB_QUEUE_START, { method: 'POST' });

/**
 * Stop queue processing
 * Expected Response: { success, message }
 */
export const stopJobQueue = () => apiRequest(API_ENDPOINTS.JOB_QUEUE_STOP, { method: 'POST' });

/**
 * Get job queue status summary
 * Expected Response: { running, pending, ... }
 */
export const getJobStatusSummary = () => apiRequest(API_ENDPOINTS.JOB_STATUS_SUMMARY);

// ============================================
// FILES IN JOB APIs
// ============================================

/**
 * Get files in a job
 * Expected Response: Array of file objects with status and order
 */
export const getJobFiles = (jobId) => apiRequest(API_ENDPOINTS.JOB_FILES(jobId));

/**
 * Get pairs data (pair table history) for editing batch
 * Expected Response: { pairsData: [...] }
 */
export const getJobPairs = (jobId) => apiRequest(API_ENDPOINTS.JOB_PAIRS(jobId));

/**
 * Stop a specific file in a job
 * Expected Response: { success: true, file: updatedFile }
 */
export const stopJobFile = (jobId, fileId) => {
  return apiRequest(API_ENDPOINTS.JOB_FILE_STOP(jobId, fileId), { method: 'POST' });
};

/**
 * Re-run a stopped file (set back to pending).
 * Expected Response: { success: true, file: { id, status } }
 */
export const rerunJobFile = (jobId, fileId) => {
  return apiRequest(API_ENDPOINTS.JOB_FILE_RERUN(jobId, fileId), { method: 'POST' });
};

/**
 * Move file up/down in job queue
 * Body: { direction: 'up' | 'down' }
 * Expected Response: { success: true, files: reorderedFiles }
 */
export const moveJobFile = (jobId, fileId, direction) => {
  return apiRequest(API_ENDPOINTS.JOB_FILE_MOVE(jobId, fileId), {
    method: 'POST',
    body: JSON.stringify({ direction }),
  });
};

/**
 * Delete a file from a job (remove test case from batch).
 * Expected Response: { success: true }
 */
export const deleteJobFile = (jobId, fileId) => {
  return apiRequest(API_ENDPOINTS.JOB_FILE_DELETE(jobId, fileId), { method: 'DELETE' });
};

// ============================================
// FILE UPLOAD APIs
// ============================================

/**
 * Check file by metadata (compare before upload). Send filename, signature (checksum), size, modifyDate.
 * Expected Response: { duplicate: boolean, existing?: { id, name, size, type, uploadDate, checksum } }
 */
export const checkFile = (payload) => apiRequest(API_ENDPOINTS.FILE_CHECK, {
  method: 'POST',
  body: JSON.stringify({
    filename: payload.filename ?? null,
    signature: payload.signature ?? payload.checksum ?? null,
    size: payload.size ?? null,
    modifyDate: payload.modifyDate ?? null,
  }),
});

/**
 * Upload a file
 * Body: FormData with file and metadata
 * Expected Response: { id, name, size, type, uploadDate }
 */
export const uploadFile = (file, metadata = {}) => {
  const formData = new FormData();
  formData.append('file', file);
  const formMeta = { ...metadata };
  if (formMeta.forceNew != null) {
    formMeta.force_new = formMeta.forceNew ? 'true' : 'false';
    delete formMeta.forceNew;
  }
  Object.keys(formMeta).forEach(key => {
    const val = formMeta[key];
    if (val != null && val !== '') formData.append(key, String(val));
  });

  return apiRequest(API_ENDPOINTS.FILE_UPLOAD, {
    method: 'POST',
    headers: {}, // Let browser set Content-Type for FormData
    body: formData,
  });
};

/**
 * Get all uploaded files
 * Expected Response: Array of file objects
 */
export const getFiles = () => apiRequest(API_ENDPOINTS.FILES);

/**
 * Get file by ID
 * Expected Response: File object
 */
export const getFileById = (id) => apiRequest(API_ENDPOINTS.FILE_BY_ID(id));

/**
 * Delete a file
 * Expected Response: { success: true }
 */
export const deleteFile = (id) => {
  return apiRequest(API_ENDPOINTS.FILE_DELETE(id), { method: 'DELETE' });
};

/**
 * Update library file tags / pill color (server-wide, all profiles see the same).
 * Body: only include fields to change (e.g. { tags: 'a, b' } or { tagColor: 'mint' }).
 */
export const patchFileLibraryTags = (fileId, payload) => {
  return apiRequest(API_ENDPOINTS.FILE_LIBRARY_TAGS_PATCH(fileId), {
    method: 'PATCH',
    body: JSON.stringify(payload || {}),
  });
};

/**
 * Save library file IDs into set storage (backend copies files to this set). Body: { file_ids: string[] }
 */
export const saveSetFiles = (setId, fileIds) => {
  return apiRequest(API_ENDPOINTS.SETS_SAVE_FILES(setId), {
    method: 'POST',
    body: JSON.stringify({ file_ids: fileIds }),
  });
};

/**
 * List files stored for this set
 */
export const listSetFiles = (setId) => apiRequest(API_ENDPOINTS.SETS_LIST_FILES(setId));

/**
 * Restore all set files into main library (copy to library so they appear in File Library)
 */
export const restoreSetFilesToLibrary = (setId) => {
  return apiRequest(API_ENDPOINTS.SETS_RESTORE_TO_LIBRARY(setId), { method: 'POST' });
};

/**
 * Delete set from backend (removes all files stored for this set_id in DB and disk)
 */
export const deleteSet = (setId) => {
  return apiRequest(API_ENDPOINTS.SETS_DELETE(setId), { method: 'DELETE' });
};

// ============================================
// PROFILES APIs (Option B1: no login)
// ============================================

/**
 * Create profile on server. Returns { id, name }. id is the share key.
 */
export const createProfileApi = (name) => {
  return apiRequest(API_ENDPOINTS.PROFILES, {
    method: 'POST',
    body: JSON.stringify({ name: name || 'Unnamed' }),
  });
};

/**
 * List all profiles on the server (id + name) — use for resolving owner display for any user.
 */
export const listProfiles = () => apiRequest(API_ENDPOINTS.PROFILES);

/**
 * Get profile metadata (id, name, updatedAt)
 */
export const getProfile = (profileId) => apiRequest(API_ENDPOINTS.PROFILE_BY_ID(profileId));

/**
 * Get all test cases and sets from all profiles (for Library "All"/"Shared" filters)
 */
export const getAllTestCasesFromProfiles = () => apiRequest(API_ENDPOINTS.PROFILES_ALL_TEST_CASES);

/**
 * Get profile data (savedTestCases, savedTestCaseSets) — read-only for shared view
 */
export const getProfileData = (profileId) => apiRequest(API_ENDPOINTS.PROFILE_DATA(profileId));

/**
 * Put profile data (sync from this device)
 */
export const putProfileData = (profileId, data) => {
  return apiRequest(API_ENDPOINTS.PROFILE_DATA(profileId), {
    method: 'PUT',
    body: JSON.stringify(data),
  });
};

/**
 * Update profile name on server
 */
export const updateProfileNameApi = (profileId, name) => {
  return apiRequest(API_ENDPOINTS.PROFILE_BY_ID(profileId), {
    method: 'PUT',
    body: JSON.stringify({ name }),
  });
};

// ============================================
// RESULTS APIs
// ============================================

/**
 * Get all results
 * Expected Response: Array of result objects
 */
export const getResults = (filters = {}) => {
  const queryParams = new URLSearchParams(filters).toString();
  const url = queryParams ? `${API_ENDPOINTS.RESULTS}?${queryParams}` : API_ENDPOINTS.RESULTS;
  return apiRequest(url);
};

/**
 * Get result by ID
 * Expected Response: Result object
 */
export const getResultById = (id) => apiRequest(API_ENDPOINTS.RESULT_BY_ID(id));

/**
 * Get result waveform data
 * Expected Response: waveform payload
 */
export const getResultWaveform = (id) => apiRequest(API_ENDPOINTS.RESULT_WAVEFORM(id));

/**
 * Get result log
 * Expected Response: log text or object
 */
export const getResultLog = (id) => apiRequest(API_ENDPOINTS.RESULT_LOG(id));

/**
 * Delete result
 * Expected Response: { success, message }
 */
export const deleteResult = (id) => {
  return apiRequest(API_ENDPOINTS.RESULT_DELETE(id), { method: 'DELETE' });
};

// ============================================
// NOTIFICATIONS APIs
// ============================================

/**
 * Get all notifications
 * Query params: ?read=false&limit=50
 * Expected Response: Array of notification objects
 */
export const getNotifications = (filters = {}) => {
  const queryParams = new URLSearchParams(filters).toString();
  const url = queryParams ? `${API_ENDPOINTS.NOTIFICATIONS}?${queryParams}` : API_ENDPOINTS.NOTIFICATIONS;
  return apiRequest(url);
};

/**
 * Create notification (persisted for current owner)
 * Body: { title, message, type, user_id?, data? }
 */
export const createNotification = (body) =>
  apiRequest(API_ENDPOINTS.NOTIFICATIONS, {
    method: 'POST',
    body: JSON.stringify(body),
  });

/**
 * Mark notification as read
 * Expected Response: { success: true }
 */
export const markNotificationRead = (id) => {
  return apiRequest(API_ENDPOINTS.NOTIFICATION_MARK_READ(id), { method: 'POST' });
};

/**
 * Mark all notifications as read
 * Query: ?user_id=... (recommended so only this owner's rows are cleared)
 * Expected Response: { success: true, count: number }
 */
export const markAllNotificationsRead = (filters = {}) => {
  const entries = Object.entries(filters).filter(([, v]) => v != null && v !== '');
  const queryParams = new URLSearchParams(Object.fromEntries(entries)).toString();
  const url = queryParams
    ? `${API_ENDPOINTS.NOTIFICATION_MARK_ALL_READ}?${queryParams}`
    : API_ENDPOINTS.NOTIFICATION_MARK_ALL_READ;
  return apiRequest(url, { method: 'POST' });
};

// ============================================
// WebSocket Helpers
// ============================================

/**
 * Create WebSocket connection for real-time updates
 * @param {string} endpoint - WebSocket endpoint
 * @param {function} onMessage - Callback for messages
 * @param {function} onError - Callback for errors
 * @returns WebSocket instance
 */
export const createWebSocket = (endpoint, onMessage, onError) => {
  const ws = new WebSocket(endpoint);
  
  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      onMessage(data);
    } catch (error) {
      console.error('WebSocket message parse error:', error);
    }
  };
  
  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
    if (onError) onError(error);
  };
  
  ws.onclose = () => {
    console.log('WebSocket connection closed');
  };
  
  return ws;
};

export default {
  // System
  getHealth,
  getSystemHealth,
  getStorageStatus,
  getBoardApiStatus,
  getMqttStatus,
  
  // Boards
  getBoards,
  getBoardById,
  getBoardStatus,
  createBoard,
  updateBoard,
  deleteBoard,
  getBoardTelemetry,
  rebootBoard,
  shutdownBoard,
  pauseBoardQueue,
  resumeBoardQueue,
  updateBoardFirmware,
  runBoardSelfTest,
  batchBoardActions,
  getBoardSSHConnection,
  
  // Jobs
  getJobs,
  getJobById,
  createJob,
  updateJob,
  startJob,
  stopJob,
  stopAllJobs,
  exportJob,
  reorderJob,
  runCommand,
  updateJobTag,
  deleteJob,
  uploadJob,
  startJobQueue,
  stopJobQueue,
  getJobStatusSummary,
  
  // Job Files
  getJobFiles,
  stopJobFile,
  rerunJobFile,
  moveJobFile,
  getJobPairs,
  
  // Files
  uploadFile,
  getFiles,
  getFileById,
  deleteFile,
  patchFileLibraryTags,
  saveSetFiles,
  listSetFiles,
  restoreSetFilesToLibrary,
  deleteSet,

  // Profiles
  createProfileApi,
  listProfiles,
  getProfile,
  getAllTestCasesFromProfiles,
  getProfileData,
  putProfileData,
  updateProfileNameApi,

  // Results
  getResults,
  getResultById,
  getResultWaveform,
  getResultLog,
  deleteResult,
  
  // Notifications
  getNotifications,
  createNotification,
  markNotificationRead,
  markAllNotificationsRead,
  
  // WebSocket
  createWebSocket,
};
