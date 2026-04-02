# 05. Frontend Architecture

## 1. Tech Stack Summary

| Category | Technology | Version | Usage |
|----------|-----------|---------|-------|
| **Core** | React | 18.2.0 | UI Components |
| **Build** | Vite | 5.0.0 | Dev Server & Bundling |
| **Styling** | Tailwind CSS | 3.3.5 | Utility-first styling |
| **State** | Zustand | 4.5.7 | Global Store (Jobs, Boards) |
| **Icons** | Lucide React | 0.300.0 | UI Icons |
| **Terminal**| @xterm/xterm | 6.0.0 | WebSSH Terminal |

## 2. File Structure & Component Roles

The application uses a **Feature-based** folder structure with a centralized Store.

```
src/
├── main.jsx                    # Entry point (Providers)
├── App.jsx                     # Layout & Routing
├── store/
│   └── useTestStore.js         # GLOBAL STATE (Single Source of Truth)
├── services/
│   ├── api.js                  # Axios instance & API methods
│   └── mockApi.js              # Fallback for offline dev
├── hooks/
│   ├── useApi.js               # Async State wrapper (loading/error)
│   ├── useFileUpload.js        # File upload logic
│   └── useJobQueue.js          # Job control logic
├── components/
│   ├── JobManagement/          # Job Cards, Queue List
│   ├── TestWorkspace/          # Job Creation (Drag & Drop)
│   ├── ResourceLibrary/        # File Browser Sidebar
│   └── Boards/                 # Board Grid & Telemetry
└── utils/
    ├── apiEndpoints.js         # Central config for URLs
    └── errorHandler.js         # Standardized error parsing
```

## 3. Detailed Component Responsibilities

### `store/useTestStore.js` (The Brain)
- **State**: Holds `boards[]`, `jobs[]`, `files[]`, `systemHealth`.
- **Actions**: `fetchBoards()`, `addJob()`, `updateJobProgress()`.
- **Persistence**: Uses `localStorage` for user preferences (Theme, Last Config).

### `services/api.js` (The Bridge)
- **Role**: Standardized method for every backend call.
- **Interceptors**: Automatically adds `Authorization: Bearer <token>` header.
- **Error Handling**: Catches 401/403 and redirects to Login.

### `hooks/useApi.js` (The UX Helper)
- **Purpose**: Wraps async calls to provide declarative UI states.
- **Returns**: `{ data, loading, error, execute }`.
- **Usage**:
  ```js
  const { data, loading, execute } = useApi(api.getBoards);
  useEffect(() => execute(), []);
  if (loading) return <Spinner />;
  ```

### `components/JobManagement/JobCard.jsx`
- **Visuals**: Displays Job Name, Progress Bar, and assigned Board.
- **Logic**: Calculates "Time Remaining" based on historical comparisons.
- **Actions**: "Cancel" button triggers `api.cancelJob(id)`.

### `components/TestWorkspace/Workspace.jsx`
- **Builder Pattern**: Allows users to assemble a test config.
- **Drag & Drop**: Accepts files from `ResourceLibrary` sidebar.
- **Submit**: Validates presence of VCD/Firmware before calling `api.createJob()`.

## 4. Data Flow Pattern

### A. State Synchronization (Poll + Push)
1. **Initial**: `App.jsx` mounts -> calls `store.fetchAll()`.
2. **Updates**: 
    - **Polling**: Every 30s for backup safety.
    - **WebSocket**: (Primary) Backend pushes `BOARD_UPDATE` events.
3. **Reaction**: Store updates state -> UI re-renders efficiently via Selectors.

### B. Real-time Job Progress
1. **Event**: Backend sends `JOB_PROGRESS` via WS.
2. **Store Action**: `useTestStore.updateJobProgress(id, percentage)`.
3. **UI Update**: Only the specific `JobCard` re-renders (optimization).

## 5. Development Workflow
- **Run Dev**: `npm run dev` (Starts Vite at port 5173).
- **Build**: `npm run build` (Outputs to `dist/`).
- **Mock Mode**: If `VITE_USE_MOCK=true`, `services/api.js` redirects calls to `mockApi.js`.
