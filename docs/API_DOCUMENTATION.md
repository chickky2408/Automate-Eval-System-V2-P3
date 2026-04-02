# API Documentation for Backend Developers

This document describes the API endpoints that the frontend expects from the backend.

## Base URL

- Development: `http://localhost:3000/api`
- Production: Set via `VITE_API_BASE_URL` environment variable

## Authentication

All API requests should include an authentication token in the header:
```
Authorization: Bearer <token>
```

The token is stored in `localStorage.getItem('authToken')`.

## API Endpoints

### System Health

#### GET `/api/system/health`
Get system health summary.

**Response:**
```json
{
  "totalBoards": 52,
  "onlineBoards": 45,
  "busyBoards": 5,
  "errorBoards": 2,
  "storageUsage": 68,
  "storageTotal": "10TB",
  "storageUsed": "6.8TB",
  "boardApiStatus": "online"
}
```

#### GET `/api/system/storage`
Get storage status.

**Response:**
```json
{
  "usage": 68,
  "total": "10TB",
  "used": "6.8TB",
  "percentage": 68
}
```

#### GET `/api/system/board-api/status`
Get board REST API status.

**Response:**
```json
{
  "status": "online",
  "lastConnected": "2026-01-13T10:30:00Z",
  "messageCount": 1234
}
```

### Boards/Devices

#### GET `/api/boards`
Get all boards with optional filters.

**Query Parameters:**
- `status` (optional): Filter by status (online, busy, error)
- `model` (optional): Filter by model (e.g., STM32)
- `firmware` (optional): Filter by firmware version

**Response:**
```json
[
  {
    "id": 1,
    "name": "Board #1",
    "status": "online",
    "ip": "192.168.1.101",
    "mac": "00:1B:44:11:3A:B7",
    "firmware": "v2.3.1",
    "model": "STM32",
    "voltage": 3.3,
    "signal": -45,
    "temp": 42,
    "currentJob": "Batch #2024-001"
  }
]
```

#### GET `/api/boards/:id`
Get board by ID.

#### GET `/api/boards/:id/telemetry`
Get board telemetry data.

**Response:**
```json
{
  "voltage": 3.3,
  "signal": -45,
  "temp": 42,
  "timestamp": "2026-01-13T10:30:00Z"
}
```

#### POST `/api/boards/:id/reboot`
Reboot a board.

**Response:**
```json
{
  "success": true,
  "message": "Board reboot initiated"
}
```

#### POST `/api/boards/:id/firmware`
Update board firmware.

**Body (FormData):**
- `firmwareVersion`: string
- `firmwareFile`: File

**Response:**
```json
{
  "success": true,
  "message": "Firmware update initiated"
}
```

#### POST `/api/boards/:id/self-test`
Run self-test on board.

**Response:**
```json
{
  "success": true,
  "results": {
    "voltage": "pass",
    "signal": "pass",
    "temperature": "pass"
  }
}
```

#### POST `/api/boards/batch`
Batch actions on multiple boards.

**Body:**
```json
{
  "boardIds": [1, 2, 3],
  "action": "reboot",
  "firmwareVersion": "v2.3.2" // if action is updateFirmware
}
```

**Response:**
```json
{
  "success": true,
  "results": [
    { "boardId": 1, "success": true },
    { "boardId": 2, "success": true }
  ]
}
```

#### WebSocket `/api/boards/:id/ssh/connect`
Connect to board via SSH (WebSocket).

**Query Parameters:**
- `token`: Authentication token

Returns WebSocket connection for SSH terminal.

### Jobs/Batches

#### GET `/api/jobs`
Get all jobs with optional filters.

**Query Parameters:**
- `status` (optional): Filter by status (running, pending, completed)
- `tag` (optional): Filter by tag
- `clientId` (optional): Filter by client ID

**Response:**
```json
[
  {
    "id": "2024-001",
    "name": "ERQM Regression Test",
    "progress": 75,
    "status": "running",
    "tag": "Team A",
    "clientId": "client_xxx",
    "totalFiles": 20,
    "completedFiles": 15,
    "firmware": "ERQM_v2.3.bin",
    "boards": ["Board #1", "Board #3"],
    "startedAt": "2026-01-13T10:30:00Z",
    "files": [
      {
        "id": 1,
        "name": "test_case_001.vcd",
        "status": "completed",
        "result": "pass",
        "order": 1
      }
    ]
  }
]
```

#### GET `/api/jobs/:id`
Get job by ID with full details.

#### POST `/api/jobs`
Create a new job/batch.

**Body:**
```json
{
  "name": "ERQM Regression Test",
  "tag": "Team A",
  "firmware": "ERQM_v2.3.bin",
  "boards": ["Board #1", "Board #3"],
  "files": [
    {
      "name": "test_case_001.vcd",
      "order": 1
    }
  ],
  "configName": "Default_Setup"
}
```

**Response:**
```json
{
  "id": "2024-001",
  "name": "ERQM Regression Test",
  "status": "pending",
  "progress": 0,
  "createdAt": "2026-01-13T10:30:00Z"
}
```

#### POST `/api/jobs/:id/start`
Start a job.

#### POST `/api/jobs/:id/stop`
Stop a job.

#### POST `/api/jobs/stop-all`
Stop all running jobs.

**Response:**
```json
{
  "success": true,
  "stoppedCount": 3
}
```

#### GET `/api/jobs/:id/export`
Export job to JSON.

**Response:** JSON file download or JSON data.

#### PATCH `/api/jobs/:id`
Update job (e.g., tag).

**Body:**
```json
{
  "tag": "Team B"
}
```

### Files in Job

#### GET `/api/jobs/:jobId/files`
Get files in a job.

#### POST `/api/jobs/:jobId/files/:fileId/stop`
Stop a specific file in a job.

**Response:**
```json
{
  "success": true,
  "file": {
    "id": 1,
    "status": "stopped"
  }
}
```

#### POST `/api/jobs/:jobId/files/:fileId/move`
Move file up/down in job queue.

**Body:**
```json
{
  "direction": "up"
}
```

**Response:**
```json
{
  "success": true,
  "files": [
    { "id": 2, "order": 1 },
    { "id": 1, "order": 2 }
  ]
}
```

### File Upload

#### POST `/api/files/upload`
Upload a file.

**Body (FormData):**
- `file`: File object
- Additional metadata (optional)

**Response:**
```json
{
  "id": "uuid",
  "name": "test_case_001.vcd",
  "size": 2516582,
  "type": "vcd",
  "uploadDate": "2026-01-13T10:30:00Z"
}
```

#### GET `/api/files`
Get all uploaded files.

#### GET `/api/files/:id`
Get file by ID.

#### DELETE `/api/files/:id`
Delete a file.

**Response:**
```json
{
  "success": true
}
```

### Notifications

#### GET `/api/notifications`
Get all notifications.

**Query Parameters:**
- `read` (optional): Filter by read status (true/false)
- `limit` (optional): Limit number of results

**Response:**
```json
[
  {
    "id": 1,
    "title": "Batch #2024-001 Completed",
    "message": "All 20 files processed successfully",
    "time": "5m ago",
    "type": "success",
    "read": false,
    "createdAt": "2026-01-13T10:30:00Z"
  }
]
```

#### POST `/api/notifications/:id/read`
Mark notification as read.

#### POST `/api/notifications/read-all`
Mark all notifications as read.

**Response:**
```json
{
  "success": true,
  "count": 5
}
```

## WebSocket Endpoints

### `/ws/system`
WebSocket for system health updates.

**Message Format:**
```json
{
  "type": "system_health",
  "data": {
    "totalBoards": 52,
    "onlineBoards": 45
  }
}
```

### `/ws/boards`
WebSocket for board status updates.

**Message Format:**
```json
{
  "type": "board_update",
  "data": {
    "id": 1,
    "status": "online",
    "voltage": 3.3
  }
}
```

### `/ws/jobs`
WebSocket for job progress updates.

**Message Format:**
```json
{
  "type": "job_progress",
  "data": {
    "jobId": "2024-001",
    "progress": 75,
    "completedFiles": 15
  }
}
```

## Error Responses

All endpoints should return errors in the following format:

```json
{
  "message": "Error description",
  "code": "ERROR_CODE",
  "details": {}
}
```

**HTTP Status Codes:**
- `200`: Success
- `400`: Bad Request
- `401`: Unauthorized
- `403`: Forbidden
- `404`: Not Found
- `409`: Conflict
- `500`: Internal Server Error
- `503`: Service Unavailable

## Notes for Backend Developers

1. All timestamps should be in ISO 8601 format (e.g., `2026-01-13T10:30:00Z`)
2. File sizes should be in bytes
3. Progress percentages should be integers (0-100)
4. Board statuses: `online`, `busy`, `error`
5. Job statuses: `pending`, `running`, `completed`, `stopped`
6. File statuses: `pending`, `running`, `completed`, `stopped`
7. File results: `pass`, `fail` (only when status is `completed`)

## Integration Guide

1. Update `src/utils/apiEndpoints.js` with your actual API base URL
2. Implement the endpoints as described above
3. Ensure CORS is enabled for frontend origin
4. Implement WebSocket endpoints for real-time updates
5. Add authentication middleware if needed
6. Test with the mock API service first (`src/services/mockApi.js`)
