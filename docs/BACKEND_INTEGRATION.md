# Backend Integration Guide

This guide helps backend developers understand how to integrate with this frontend application.

## Quick Start

1. **Read the API Documentation**: See `API_DOCUMENTATION.md` for complete endpoint specifications
2. **Check API Endpoints**: See `src/utils/apiEndpoints.js` for all endpoint URLs
3. **Review API Service**: See `src/services/api.js` for expected request/response formats
4. **Test with Mock API**: Use `src/services/mockApi.js` as a reference for data structures

## File Structure

```
src/
├── services/
│   ├── api.js          # Main API service (replace with your backend)
│   └── mockApi.js     # Mock API for development/testing
├── utils/
│   ├── apiEndpoints.js    # All API endpoint URLs
│   └── errorHandler.js    # Error handling utilities
└── hooks/
    └── useApi.js          # React hook for API calls with loading states
```

## Integration Steps

### 1. Update API Base URL

Edit `src/utils/apiEndpoints.js`:
```javascript
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';
```

Or set environment variable:
```bash
VITE_API_BASE_URL=http://your-api-url.com/api
```

### 2. Replace Mock API with Real API

In your components, replace:
```javascript
// Development (using mock)
import mockApi from '../services/mockApi';

// Production (using real API)
import api from '../services/api';
```

### 3. Implement Required Endpoints

See `API_DOCUMENTATION.md` for complete specifications. Key endpoints:

- **System Health**: `/api/system/health`, `/api/system/storage`, `/api/system/board-api/status`
- **Boards**: `/api/boards`, `/api/boards/:id`, `/api/boards/:id/reboot`, etc.
- **Jobs**: `/api/jobs`, `/api/jobs/:id`, `/api/jobs/:id/start`, etc.
- **Files**: `/api/files/upload`, `/api/files`, `/api/files/:id`
- **Notifications**: `/api/notifications`

### 4. Implement WebSocket Endpoints

For real-time updates:
- `/ws/system` - System health updates
- `/ws/boards` - Board status updates
- `/ws/jobs` - Job progress updates

### 5. Handle Authentication

The frontend expects:
- Token stored in `localStorage.getItem('authToken')`
- Token sent in header: `Authorization: Bearer <token>`
- 401 response triggers re-authentication

### 6. Error Handling

The frontend expects errors in this format:
```json
{
  "message": "Error description",
  "code": "ERROR_CODE"
}
```

HTTP status codes:
- `200`: Success
- `400`: Bad Request
- `401`: Unauthorized
- `403`: Forbidden
- `404`: Not Found
- `500`: Server Error

## Data Structures

### Board Object
```typescript
{
  id: number;
  name: string;
  status: 'online' | 'busy' | 'error';
  ip: string;
  mac: string;
  firmware: string;
  model: string;
  voltage?: number;
  signal?: number;
  temp?: number;
  currentJob?: string | null;
}
```

### Job Object
```typescript
{
  id: string;
  name: string;
  progress: number; // 0-100
  status: 'pending' | 'running' | 'completed' | 'stopped';
  tag?: string;
  clientId: string;
  totalFiles: number;
  completedFiles: number;
  firmware: string;
  boards: string[];
  startedAt: string; // ISO 8601
  completedAt?: string; // ISO 8601
  files: FileInJob[];
}
```

### File in Job
```typescript
{
  id: number;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'stopped';
  result?: 'pass' | 'fail';
  order: number;
}
```

## Testing

1. **Use Mock API**: The frontend includes a mock API service for testing
2. **Test Endpoints**: Use Postman/Insomnia to test your endpoints
3. **Check Console**: Frontend logs all API calls and errors to console

## Common Issues

### CORS Errors
Ensure your backend allows CORS from the frontend origin:
```javascript
// Express example
app.use(cors({
  origin: 'http://localhost:5173', // Vite default
  credentials: true
}));
```

### WebSocket Connection
Ensure WebSocket server is running and accessible:
```javascript
// Check WebSocket URL in apiEndpoints.js
WS_BASE_URL: 'ws://localhost:3000'
```

### File Upload
Ensure multipart/form-data is handled correctly:
```javascript
// Express example
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });
app.post('/api/files/upload', upload.single('file'), ...);
```

## Environment Variables

Create `.env` file:
```env
VITE_API_BASE_URL=http://localhost:3000/api
VITE_WS_BASE_URL=ws://localhost:3000
```

## Support

For questions or issues:
1. Check `API_DOCUMENTATION.md` for endpoint details
2. Review `src/services/api.js` for expected request/response formats
3. Check browser console for error messages
