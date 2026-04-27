/**
 * API Endpoints Configuration
 * 
 * Backend developers: Update these endpoints to match your API routes
 * Set API_BASE_URL in your environment variables or update it here
 *
 * For Docker / same-host deploy: set VITE_API_BASE_URL=/api so requests use the
 * current browser origin (not localhost on each teammate's machine).
 */

const configuredApiBase = import.meta.env.VITE_API_BASE_URL;
const API_BASE_URL = configuredApiBase || 'http://localhost:8000/api';

const API_ORIGIN = (() => {
  if (configuredApiBase?.startsWith('/')) {
    return typeof window !== 'undefined' ? window.location.origin : '';
  }
  const u = configuredApiBase || 'http://localhost:8000/api';
  return u.replace(/\/api\/?$/, '') || 'http://localhost:8000';
})();

const configuredWsBase = import.meta.env.VITE_WS_BASE_URL;
const WS_BASE_URL =
  configuredWsBase ||
  (() => {
    if (configuredApiBase?.startsWith('/')) {
      if (typeof window !== 'undefined') {
        const p = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${p}//${window.location.host}`;
      }
    }
    return 'ws://localhost:8000';
  })();

/**
 * ใช้ในข้อความ error เมื่อ fetch ล้ม (เช่น Safari "Load failed")
 * @param {Error|unknown} error
 * @returns {string}
 */
export function formatClientNetworkError(error) {
  const raw = error?.message != null ? String(error.message) : String(error) || 'Unknown error';
  const low = raw.toLowerCase();
  const looksNetwork =
    low.includes('load failed') ||
    low.includes('failed to fetch') ||
    low.includes('networkerror') ||
    low.includes('network request failed');
  if (!looksNetwork) return raw;

  const host = typeof window !== 'undefined' ? window.location.hostname : '';
  const onLan = host && !['localhost', '127.0.0.1', '::1'].includes(host);
  const baseStr = String(API_BASE_URL || '');
  let apiToLocalhost = false;
  if (baseStr.startsWith('/')) {
    apiToLocalhost = false;
  } else {
    apiToLocalhost = /\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(baseStr);
  }

  const hint =
    onLan && apiToLocalhost
      ? ` ตั้ง VITE_API_BASE_URL=http://${host}:8000/api ใน env ของ frontend แล้วรีสตาร์ต npm run dev (ตอนนี้ API=${baseStr || '—'})`
      : ` ตรวจ backend รันที่พอร์ตเดียวกับ API (${baseStr || '—'}) และลองรีเฟรช`;
  return `${raw} —${hint}`;
}

export const API_ENDPOINTS = {
  // System Health
  HEALTH: `${API_ORIGIN}/api/health`,
  SYSTEM_HEALTH: `${API_BASE_URL}/system/health`,
  STORAGE_STATUS: `${API_BASE_URL}/system/storage`,
  BOARD_API_STATUS: `${API_BASE_URL}/system/board-api/status`,
  MQTT_STATUS: `${API_BASE_URL}/system/mqtt/status`,
  
  // Boards/Devices Management
  BOARDS: `${API_BASE_URL}/boards`,
  BOARD_BY_ID: (id) => `${API_BASE_URL}/boards/${id}`,
  BOARD_CREATE: `${API_BASE_URL}/boards`,
  BOARD_UPDATE: (id) => `${API_BASE_URL}/boards/${id}`,
  BOARD_DELETE: (id) => `${API_BASE_URL}/boards/${id}`,
  BOARD_TELEMETRY: (id) => `${API_BASE_URL}/boards/${id}/telemetry`,
  BOARD_REBOOT: (id) => `${API_BASE_URL}/boards/${id}/reboot`,
  BOARD_SHUTDOWN: (id) => `${API_BASE_URL}/boards/${id}/shutdown`,
  BOARD_PAUSE_QUEUE: (id) => `${API_BASE_URL}/boards/${id}/pause-queue`,
  BOARD_RESUME_QUEUE: (id) => `${API_BASE_URL}/boards/${id}/resume-queue`,
  BOARD_UPDATE_FIRMWARE: (id) => `${API_BASE_URL}/boards/${id}/firmware`,
  BOARD_SELF_TEST: (id) => `${API_BASE_URL}/boards/${id}/self-test`,
  BOARD_BATCH_ACTIONS: `${API_BASE_URL}/boards/batch`,
  BOARD_SSH_CONNECT: (id) => `${API_BASE_URL}/boards/${id}/ssh/connect`,
  /** WebSocket URL for SSH proxy (use ws://, not http) */
  BOARD_SSH_WS: (id) => `${WS_BASE_URL}/api/boards/${id}/ssh/connect`,
  BOARD_STATUS: (id) => `${API_BASE_URL}/boards/${id}/status`,
  
  // Jobs/Batches Management
  JOBS: `${API_BASE_URL}/jobs`,
  JOB_BY_ID: (id) => `${API_BASE_URL}/jobs/${id}`,
  JOB_CREATE: `${API_BASE_URL}/jobs`,
  JOB_START: (id) => `${API_BASE_URL}/jobs/${id}/start`,
  JOB_STOP: (id) => `${API_BASE_URL}/jobs/${id}/stop`,
  JOB_STOP_ALL: `${API_BASE_URL}/jobs/stop-all`,
  JOB_EXPORT: (id) => `${API_BASE_URL}/jobs/${id}/export`,
  JOB_REORDER: (id) => `${API_BASE_URL}/jobs/${id}/reorder`,
  JOB_DELETE: (id) => `${API_BASE_URL}/jobs/${id}`,
  JOB_RUN_COMMAND: `${API_BASE_URL}/jobs/run-command`,
  JOB_UPLOAD: `${API_BASE_URL}/jobs/upload`,
  JOB_QUEUE_START: `${API_BASE_URL}/jobs/start`,
  JOB_QUEUE_STOP: `${API_BASE_URL}/jobs/stop`,
  JOB_STATUS_SUMMARY: `${API_BASE_URL}/jobs/status/summary`,
  
  // Files in Job
  JOB_FILES: (jobId) => `${API_BASE_URL}/jobs/${jobId}/files`,
  JOB_FILE_STOP: (jobId, fileId) => `${API_BASE_URL}/jobs/${jobId}/files/${fileId}/stop`,
  JOB_FILE_RERUN: (jobId, fileId) => `${API_BASE_URL}/jobs/${jobId}/files/${fileId}/rerun`,
  JOB_FILE_MOVE: (jobId, fileId) => `${API_BASE_URL}/jobs/${jobId}/files/${fileId}/move`,
  JOB_FILE_DELETE: (jobId, fileId) => `${API_BASE_URL}/jobs/${jobId}/files/${fileId}`,
  JOB_PAIRS: (jobId) => `${API_BASE_URL}/jobs/${jobId}/pairs`, // Get pairs data for editing
  JOB_FILES_SYNC: (jobId, status) => `${API_BASE_URL}/jobs/${jobId}/files/sync`,
  
  // Test Commands
  TEST_COMMANDS: `${API_BASE_URL}/test-commands`,
  TEST_COMMAND_BY_ID: (id) => `${API_BASE_URL}/test-commands/${id}`,
  
  // File Tags
  FILE_TAGS: `${API_BASE_URL}/file-tags`,
  FILE_TAG_BY_ID: (id) => `${API_BASE_URL}/file-tags/${id}`,
  
  // Test Cases/Sets
  TEST_CASES: `${API_BASE_URL}/test-management/test-cases`,
  TEST_CASES_BY_ID: (id) => `${API_BASE_URL}/test-management/test-cases/${id}`,
  TEST_SETS: `${API_BASE_URL}/test-management/test-sets`,
  TEST_SETS_BY_ID: (id) => `${API_BASE_URL}/test-management/test-sets/${id}`,
  TEST_SETS_ITEMS: (setId) => `${API_BASE_URL}/test-management/test-sets/${setId}/items`,
  TEST_SETS_ADD_ITEM: (setId) => `${API_BASE_URL}/test-management/test-sets/${setId}/items`,
  TEST_SETS_REMOVE_ITEM: (setId, testCaseId) => `${API_BASE_URL}/test-management/test-sets/${setId}/items/${testCaseId}`,
  TEST_SETS_UPDATE_ITEM_ORDER: (setId, testCaseId) => `${API_BASE_URL}/test-management/test-sets/${setId}/items/${testCaseId}/order`,
  
  // File Upload (compare-before-upload: send metadata first, then user decides)
  FILE_CHECK: `${API_BASE_URL}/files/check`,
  FILE_UPLOAD: `${API_BASE_URL}/files/upload`,
  FILES: `${API_BASE_URL}/files`,
  FILE_BY_ID: (id) => `${API_BASE_URL}/files/${id}`,
  FILE_DELETE: (id) => `${API_BASE_URL}/files/${id}`,
  /** PATCH body: { tags?: string, tagColor?: string } — shared across all profiles */
  FILE_LIBRARY_TAGS_PATCH: (id) => `${API_BASE_URL}/files/${id}/library-tags`,

  // Set-scoped files (บันทึก/กู้คืนไฟล์ตาม Set)
  SETS_SAVE_FILES: (setId) => `${API_BASE_URL}/sets/${setId}/files/save`,
  SETS_LIST_FILES: (setId) => `${API_BASE_URL}/sets/${setId}/files`,
  SETS_RESTORE_TO_LIBRARY: (setId) => `${API_BASE_URL}/sets/${setId}/files/restore-to-library`,
  SETS_DELETE: (setId) => `${API_BASE_URL}/sets/${setId}`,

  // Profiles (Option B1: no login; profile id = share key)
  PROFILES: `${API_BASE_URL}/profiles`,
  PROFILES_ALL_TEST_CASES: `${API_BASE_URL}/profiles/all-test-cases`,
  PROFILE_BY_ID: (id) => `${API_BASE_URL}/profiles/${id}`,
  PROFILE_DATA: (id) => `${API_BASE_URL}/profiles/${id}/data`,

  // Notifications
  NOTIFICATIONS: `${API_BASE_URL}/notifications`,
  NOTIFICATION_MARK_READ: (id) => `${API_BASE_URL}/notifications/${id}/read`,
  NOTIFICATION_MARK_ALL_READ: `${API_BASE_URL}/notifications/read-all`,
  
  // Results
  RESULTS: `${API_BASE_URL}/results`,
  RESULT_BY_ID: (id) => `${API_BASE_URL}/results/${id}`,
  RESULT_WAVEFORM: (id) => `${API_BASE_URL}/results/${id}/waveform`,
  RESULT_LOG: (id) => `${API_BASE_URL}/results/${id}/log`,
  RESULT_DELETE: (id) => `${API_BASE_URL}/results/${id}`,
  
  // WebSocket (for real-time updates)
  WS_BASE_URL,
  WS_SYSTEM: `${WS_BASE_URL}/ws/system`,
  WS_BOARDS: `${WS_BASE_URL}/ws/boards`,
  WS_JOBS: `${WS_BASE_URL}/ws/jobs`,
  /** Waveform streaming: Sine 125kHz @ fs=1MHz (backend simulates Node → UXUI) */
  WS_WAVEFORM: `${WS_BASE_URL}/ws/waveform`,
};

export { API_BASE_URL, API_ORIGIN, WS_BASE_URL };
export default API_ENDPOINTS;
