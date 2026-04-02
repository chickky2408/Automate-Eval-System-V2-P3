# Frontend Management System

A comprehensive frontend application for managing test boards, jobs, and system monitoring.

## Features

- 📊 **Dashboard**: System health overview, active campaigns, notifications
- 🔧 **Test Case Setup**: File upload, configuration, tag management
- 📋 **Job Management**: Create, manage, and monitor test jobs with file-level control
- 🖥️ **Fleet Manager**: Manage 50+ boards with grid/list views, filtering, batch actions
- 🔔 **Notifications**: Real-time notifications and alerts
- 🏷️ **Tag System**: Organize jobs with tags/groups
- 📤 **File Management**: Upload, organize, and manage test files
- 🖥️ **WebSSH Terminal**: Direct SSH access to boards via web interface

## Tech Stack

- **React 18** - UI Framework
- **Vite** - Build tool
- **Zustand** - State management
- **Tailwind CSS** - Styling
- **Lucide React** - Icons
- **xterm.js** - Terminal emulator

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn

### Installation

```bash
npm install
```

### Development

```bash
npm run dev
```

The app will be available at `http://localhost:5173`

### Build

```bash
npm run build
```

### Preview Production Build

```bash
npm run preview
```

## Project Structure

```
src/
├── components/          # React components
│   ├── Common/          # Shared components
│   ├── JobManagement/   # Job-related components
│   └── TestWorkspace/   # Workspace components
├── hooks/               # Custom React hooks
│   ├── useApi.js        # API call hook with loading states
│   ├── useFileUpload.js # File upload hook
│   └── useJobQueue.js   # Job queue management
├── services/            # API services
│   ├── api.js           # Main API service (to be implemented)
│   └── mockApi.js       # Mock API for development
├── store/               # Zustand stores
│   └── useTestStore.js  # Main application store
└── utils/               # Utility functions
    ├── apiEndpoints.js  # API endpoint definitions
    ├── constants.js      # Application constants
    ├── errorHandler.js  # Error handling utilities
    ├── fileHelpers.js   # File utility functions
    └── sessionStorage.js # Session management
```

## Backend Integration

This frontend is designed to work with a backend API. See:

- **[API_DOCUMENTATION.md](./API_DOCUMENTATION.md)** - Complete API specifications
- **[BACKEND_INTEGRATION.md](./BACKEND_INTEGRATION.md)** - Integration guide for backend developers

### Quick Integration Steps

1. Set API base URL in `src/utils/apiEndpoints.js` or via environment variable:
   ```env
   VITE_API_BASE_URL=http://your-api-url.com/api
   ```

2. Implement the endpoints as specified in `API_DOCUMENTATION.md`

3. Replace mock API calls with real API calls in components

## Environment Variables

Create a `.env` file:

```env
VITE_API_BASE_URL=http://localhost:3000/api
VITE_WS_BASE_URL=ws://localhost:3000
```

## Key Features Explained

### 1. Dashboard
- System health monitoring
- Active job tracking with "My Jobs" filter
- Notification center
- Board REST API status

### 2. Test Case Setup
- Drag & drop file upload
- File management (select, delete)
- Tag/group assignment
- Config export to JSON

### 3. Job Management
- Create jobs with tags
- File-level control (stop individual files)
- Reorder files (move up/down)
- Export job to JSON
- Progress tracking

### 4. Fleet Manager
- Grid and list view modes
- Smart filtering (status, model, firmware)
- Batch actions (reboot, update firmware, self-test)
- Device details panel with telemetry
- WebSSH terminal integration

## API Service Layer

The application uses a service layer pattern for API calls:

```javascript
import api from './services/api';

// Example: Get boards
const boards = await api.getBoards({ status: 'online' });

// Example: Create job
const job = await api.createJob({
  name: 'Test Job',
  tag: 'Team A',
  files: [...]
});
```

See `src/services/api.js` for all available API functions.

## Error Handling

The application includes centralized error handling:

```javascript
import { handleApiError, showError } from './utils/errorHandler';

try {
  await api.someFunction();
} catch (error) {
  const errorInfo = handleApiError(error);
  showError(error, 'Operation failed');
}
```

## Loading States

Use the `useApi` hook for automatic loading state management:

```javascript
import useApi from './hooks/useApi';
import api from './services/api';

function MyComponent() {
  const { data, loading, error, execute } = useApi(api.getBoards);
  
  useEffect(() => {
    execute();
  }, []);
  
  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;
  
  return <div>{/* Render data */}</div>;
}
```

## Development Notes

- Mock API service is available in `src/services/mockApi.js` for development
- All API endpoints are defined in `src/utils/apiEndpoints.js`
- State management uses Zustand (see `src/store/useTestStore.js`)
- Session tracking uses browser sessionStorage for "My Jobs" filtering

## Contributing

1. Follow the existing code structure
2. Use the API service layer for all backend calls
3. Add error handling for all API calls
4. Update API documentation when adding new endpoints
5. Test with mock API before integrating real backend

## License

Private project - All rights reserved
