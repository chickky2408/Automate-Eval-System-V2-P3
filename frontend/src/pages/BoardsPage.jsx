import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { 
  Menu, X, LayoutDashboard, Settings, PlayCircle, Cpu, 
  History, Bell, Upload, FileCode, Box, Search, 
  CheckCircle2, AlertCircle, Clock, Zap, Database, ChevronRight,
  Grid3x3, List, Filter, Terminal, Wifi, WifiOff, HardDrive,
  RefreshCw, Download, Activity, XCircle, Eye, MoreVertical,
  ArrowUp, ArrowDown, Square, Tag, FileJson, StopCircle, Plus,
  Command, Copy, Play, Layers, Monitor, ChevronDown, ChevronUp, GripVertical, ChevronLeft, CheckSquare, Pencil,
  Pause, ZoomIn, ZoomOut, Trash2, Gauge, User, UserPlus, LogOut, Save, FileDown, FileUp, FolderOpen,
  Lock, Globe, Users
} from 'lucide-react';
import BoardCard from '../components/boards/BoardCard';
import BoardTableRow from '../components/boards/BoardTableRow';
import DeviceDetailsPanel from '../components/boards/DeviceDetailsPanel';
import WebSSHTerminal from '../components/boards/WebSSHTerminal';
import TestCommandsManagerModal from '../components/boards/TestCommandsManagerModal';
import AddBoardModal from '../components/boards/AddBoardModal';
import { useTestStore } from '../store/useTestStore';

// 4. FLEET MANAGER PAGE (Enhanced)
const BoardsPage = () => {
  const {
    boards,
    jobs,
    fleetViewMode,
    fleetFilters,
    selectedBoards,
    setFleetViewMode,
    setFleetFilter,
    toggleBoardSelection,
    selectAllBoards,
    clearBoardSelection,
    runBoardBatchAction,
    deleteBoards,
    refreshBoards,
    loading,
    errors
  } = useTestStore();
  const addToast = useTestStore((state) => state.addToast);
  const setBoardQueuePaused = useTestStore((state) => state.setBoardQueuePaused);
  const boardQueuePaused = useTestStore((state) => state.boardQueuePaused || {});

  const realBoards = boards || [];

  const demoBoards = useMemo(
    () => [
      // ONLINE group (idle / ready)
      {
        id: 'BOARD-1',
        name: 'Demo Board 1',
        status: 'online',
        ip: '192.168.0.10',
        mac: '00:11:22:33:44:55',
        firmware: 'v1.0.0',
        model: 'Zybo',
        tag: 'paused',
        fpgaStatus: 'unknown',
        armStatus: 'online',
        currentJob: 'Idle',
        voltage: '3.3',
        queuePaused: true,
        isDemo: true,
      },
      {
        id: 'BOARD-2',
        name: 'Line A – Ready',
        status: 'online',
        ip: '192.168.0.11',
        mac: '00:11:22:33:44:66',
        firmware: 'v1.0.3',
        model: 'Zybo',
        tag: 'line-a',
        fpgaStatus: 'active',
        armStatus: 'online',
        currentJob: 'Idle',
        voltage: '3.3',
        queuePaused: false,
        isDemo: true,
      },

      // BUSY group (กำลังรันงาน)
      {
        id: 'BOARD-3',
        name: 'Burn-in Tester 1',
        status: 'busy',
        ip: '192.168.0.21',
        mac: '00:11:22:33:44:88',
        firmware: 'v1.1.0',
        model: 'Zybo',
        tag: 'burn-in',
        fpgaStatus: 'active',
        armStatus: 'busy',
        currentJob: 'Batch #123 · Functional',
        voltage: '3.3',
        queuePaused: false,
        isDemo: true,
      },
      {
        id: 'BOARD-4',
        name: 'Demo Board – Busy',
        status: 'busy',
        ip: '192.168.0.22',
        mac: '00:11:22:33:44:99',
        firmware: 'v1.0.5',
        model: 'Zybo',
        tag: 'running',
        fpgaStatus: 'active',
        armStatus: 'busy',
        currentJob: 'Set 02 · Regression',
        voltage: '3.3',
        queuePaused: false,
        isDemo: true,
      },

      // ERROR / OFFLINE group
      {
        id: 'BOARD-ERR',
        name: 'Demo Error Board',
        status: 'error',
        ip: '192.168.0.31',
        mac: '00:11:22:33:44:77',
        firmware: 'v1.0.0',
        model: 'Zybo',
        tag: 'error',
        fpgaStatus: 'error',
        armStatus: 'offline',
        currentJob: 'Idle',
        voltage: '3.3',
        queuePaused: false,
        isDemo: true,
      },
      {
        id: 'BOARD-OFF',
        name: 'Spare Board (offline)',
        status: 'error',
        ip: '192.168.0.32',
        mac: '00:11:22:33:44:AA',
        firmware: 'v0.9.0',
        model: 'Zybo',
        tag: 'maintenance',
        fpgaStatus: 'offline',
        armStatus: 'offline',
        currentJob: '—',
        voltage: '0.0',
        queuePaused: false,
        isDemo: true,
      },
    ],
    []
  );

  const boardsWithDemo = useMemo(() => {
    const realIds = new Set(realBoards.map((b) => String(b.id)));
    const merged = [
      ...demoBoards.filter((b) => !realIds.has(String(b.id))),
      ...realBoards,
    ];
    return merged.map((b) => {
      const override = boardQueuePaused[String(b.id)];
      return override === undefined ? b : { ...b, queuePaused: override };
    });
  }, [realBoards, demoBoards, boardQueuePaused]);

  const notSupportedMessage = 'This feature is pending backend support';

  const handleViewDetails = (board) => {
    setSelectedBoard(board);
    setShowDetails(true);
  };

  const handlePauseQueue = async (board) => {
    setBoardQueuePaused(board.id, true);
    addToast({ type: 'success', message: `Paused queue: ${board.name || board.id}` });
    try {
      await api.pauseBoardQueue(board.id);
      await refreshBoards();
    } catch (e) {
      // demo-only: ไม่ทำอะไรเพิ่ม ให้ใช้ state ฝั่ง frontend เป็นหลัก
    }
  };

  const handleResumeQueue = async (board) => {
    setBoardQueuePaused(board.id, false);
    addToast({ type: 'success', message: `Resumed queue: ${board.name || board.id}` });
    try {
      await api.resumeBoardQueue(board.id);
      await refreshBoards();
    } catch (e) {
      // demo-only: ไม่ทำอะไรเพิ่ม ให้ใช้ state ฝั่ง frontend เป็นหลัก
    }
  };

  const handleRestartBoard = async (board) => {
    try {
      await api.rebootBoard(board.id);
      await refreshBoards();
      addToast({ type: 'success', message: `Restart sent: ${board.name || board.id}` });
    } catch (e) {
      addToast({ type: 'error', message: 'Restart failed' });
    }
  };

  const handleShutdownBoard = async (board) => {
    if (!window.confirm(`Stop board ${board.name || board.id}?`)) return;
    try {
      await api.shutdownBoard(board.id);
      await refreshBoards();
      addToast({ type: 'success', message: `Stop command sent: ${board.name || board.id}` });
    } catch (e) {
      addToast({ type: 'warning', message: notSupportedMessage });
    }
  };
  
  const [selectedBoard, setSelectedBoard] = useState(null);
  const [showDetails, setShowDetails] = useState(false);
  const [showSSH, setShowSSH] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [showAddBoard, setShowAddBoard] = useState(false);
  const [isDeletingSelected, setIsDeletingSelected] = useState(false);
  const [isBatchActionRunning, setIsBatchActionRunning] = useState(false);
  const [isRefreshingBoards, setIsRefreshingBoards] = useState(false);
  
  // Filter boards (real + demo)
  const filteredBoards = boardsWithDemo.filter(board => {
    if (fleetFilters.status && board.status !== fleetFilters.status) return false;
    if (fleetFilters.model && board.model !== fleetFilters.model) return false;
    if (fleetFilters.firmware && board.firmware !== fleetFilters.firmware) return false;
    return true;
  });
  
  // Get unique values for filters
  const uniqueStatuses = [...new Set(boards.map(b => b.status))];
  const uniqueModels = [...new Set(boards.map(b => b.model))];
  const uniqueFirmwares = [...new Set(boards.map(b => b.firmware))];
  
  const handleBoardClick = (board) => {
    setSelectedBoard(board);
    setShowDetails(true);
  };
  
  const handleRightClick = (e, board) => {
    e.preventDefault();
    if (selectedBoards.includes(board.id)) {
      setContextMenu({ x: e.clientX, y: e.clientY, boards: selectedBoards });
    } else {
      setContextMenu({ x: e.clientX, y: e.clientY, boards: [board.id] });
    }
    setShowContextMenu(true);
  };
  
  const handleBatchAction = async (action) => {
    const targetBoards = contextMenu?.boards || selectedBoards;
    if (targetBoards.length === 0) {
      addToast({ type: 'warning', message: 'No boards selected.' });
      return;
    }

    if (action === 'Update Firmware') {
      const firmwareVersion = window.prompt('Enter firmware version to apply:');
      if (!firmwareVersion) {
        return;
      }
      if (isBatchActionRunning) return;
      setIsBatchActionRunning(true);
      const response = await runBoardBatchAction(targetBoards, 'updateFirmware', { firmwareVersion });
      setIsBatchActionRunning(false);
      if (response) {
        addToast({ type: 'success', message: 'Firmware update queued.' });
      } else {
        addToast({ type: 'error', message: 'Failed to update firmware.' });
      }
    } else if (action === 'Self-Test') {
      if (isBatchActionRunning) return;
      setIsBatchActionRunning(true);
      const response = await runBoardBatchAction(targetBoards, 'selfTest');
      setIsBatchActionRunning(false);
      if (response) {
        addToast({ type: 'success', message: 'Self-test started.' });
      } else {
        addToast({ type: 'error', message: 'Failed to start self-test.' });
      }
    } else {
      if (isBatchActionRunning) return;
      setIsBatchActionRunning(true);
      const response = await runBoardBatchAction(targetBoards, 'reboot');
      setIsBatchActionRunning(false);
      if (response) {
        addToast({ type: 'success', message: 'Reboot started.' });
      } else {
        addToast({ type: 'error', message: 'Failed to reboot boards.' });
      }
    }
    setShowContextMenu(false);
    setContextMenu(null);
  };
  
  const hasBoardError = errors?.boards;
  const isBoardsLoading = loading?.boards;

  return (
    <div className="space-y-4 min-w-0">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:justify-between sm:items-center gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-slate-100">Fleet Manager</h1>
          <p className="text-slate-500 dark:text-slate-400 mt-1 text-sm sm:text-base">Manage {boardsWithDemo.length} boards across the facility</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <button
            onClick={() => setShowAddBoard(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 transition-all"
          >
            + Add Board
          </button>
          <button
            onClick={() => setFleetViewMode('grid')}
            className={`p-2 rounded-lg transition-all ${
              fleetViewMode === 'grid' 
                ? 'bg-blue-600 text-white' 
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <Grid3x3 size={20} />
          </button>
          <button
            onClick={() => setFleetViewMode('list')}
            className={`p-2 rounded-lg transition-all ${
              fleetViewMode === 'list' 
                ? 'bg-blue-600 text-white' 
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <List size={20} />
          </button>
          <button
            onClick={async () => {
              if (isRefreshingBoards) return;
              setIsRefreshingBoards(true);
              await refreshBoards();
              setIsRefreshingBoards(false);
            }}
            disabled={isRefreshingBoards}
            title="Refresh board list"
            className={`p-2 rounded-lg transition-all flex items-center gap-1.5 ${
              isRefreshingBoards
                ? 'bg-slate-100 text-slate-400 cursor-wait'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600'
            }`}
          >
            <RefreshCw size={20} className={isRefreshingBoards ? 'animate-spin' : ''} />
            <span className="text-sm font-semibold hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>
      
      {/* Smart Filtering */}
      <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-700 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <Filter size={18} className="text-slate-400 dark:text-slate-500" />
          <span className="text-sm font-bold text-slate-600 dark:text-slate-300">Filters:</span>
        </div>
        
        <select
          value={fleetFilters.status || ''}
          onChange={(e) => setFleetFilter('status', e.target.value || null)}
          className="px-3 py-1.5 border border-slate-200 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All Status</option>
          {uniqueStatuses.map(s => (
            <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
          ))}
        </select>
        
        <select
          value={fleetFilters.model || ''}
          onChange={(e) => setFleetFilter('model', e.target.value || null)}
          className="px-3 py-1.5 border border-slate-200 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All Models</option>
          {uniqueModels.map(m => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        
        <select
          value={fleetFilters.firmware || ''}
          onChange={(e) => setFleetFilter('firmware', e.target.value || null)}
          className="px-3 py-1.5 border border-slate-200 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All Firmware</option>
          {uniqueFirmwares.map(f => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
        
        {(fleetFilters.status || fleetFilters.model || fleetFilters.firmware) && (
          <button
            onClick={() => {
              setFleetFilter('status', null);
              setFleetFilter('model', null);
              setFleetFilter('firmware', null);
            }}
            className="text-xs text-red-600 font-bold hover:text-red-800"
          >
            Clear Filters
          </button>
        )}
        
        {selectedBoards.length > 0 && (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-sm text-slate-600 dark:text-slate-300 font-bold">
              {selectedBoards.length} selected
            </span>
            <button
              onClick={clearBoardSelection}
              className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            >
              Clear
            </button>
          </div>
        )}
          </div>
      
      {/* Batch Actions Bar */}
      {selectedBoards.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <span className="text-sm font-bold text-blue-900">
            {selectedBoards.length} board(s) selected
          </span>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={async () => {
                if (!window.confirm(`Delete ${selectedBoards.length} board(s)?`)) return;
                if (isDeletingSelected) return;
                setIsDeletingSelected(true);
                const success = await deleteBoards(selectedBoards);
                setIsDeletingSelected(false);
                if (success) {
                  addToast({ type: 'success', message: 'Boards deleted successfully.' });
                } else {
                  addToast({ type: 'error', message: 'Failed to delete boards.' });
                }
              }}
              disabled={isDeletingSelected}
              className={`px-4 py-2 bg-red-50 border border-red-200 rounded-lg text-sm font-bold text-red-700 transition-all ${isDeletingSelected ? 'opacity-60 cursor-not-allowed' : 'hover:bg-red-100'}`}
            >
              <XCircle size={16} className="inline mr-2" />
              {isDeletingSelected ? 'Deleting...' : 'Delete Selected'}
            </button>
            <button
              onClick={() => handleBatchAction('Reboot')}
              disabled={isBatchActionRunning}
              className={`px-4 py-2 bg-white border border-blue-300 rounded-lg text-sm font-bold text-blue-700 transition-all ${isBatchActionRunning ? 'opacity-60 cursor-not-allowed' : 'hover:bg-blue-100'}`}
            >
              <RefreshCw size={16} className="inline mr-2" />
              Reboot Selected
            </button>
            <button
              onClick={() => handleBatchAction('Update Firmware')}
              disabled={isBatchActionRunning}
              className={`px-4 py-2 bg-white border border-blue-300 rounded-lg text-sm font-bold text-blue-700 transition-all ${isBatchActionRunning ? 'opacity-60 cursor-not-allowed' : 'hover:bg-blue-100'}`}
            >
              <Download size={16} className="inline mr-2" />
              Update Firmware
            </button>
            <button
              onClick={() => handleBatchAction('Self-Test')}
              disabled={isBatchActionRunning}
              className={`px-4 py-2 bg-white border border-blue-300 rounded-lg text-sm font-bold text-blue-700 transition-all ${isBatchActionRunning ? 'opacity-60 cursor-not-allowed' : 'hover:bg-blue-100'}`}
            >
              <Activity size={16} className="inline mr-2" />
              Self-Test
            </button>
        </div>
        </div>
      )}

      {(isBoardsLoading || hasBoardError) && (
        <div className={`rounded-xl border px-4 py-3 text-sm ${
          hasBoardError ? 'bg-red-50 border-red-200 text-red-700' : 'bg-blue-50 border-blue-200 text-blue-700'
        }`}>
          {hasBoardError ? `Failed to load boards: ${hasBoardError}` : 'Loading boards...'}
        </div>
      )}

      {(!isBoardsLoading && !hasBoardError && filteredBoards.length === 0) && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-10 text-center text-slate-500 dark:text-slate-400">
          No boards found
        </div>
      )}
      
      {/* View Content */}
      {fleetViewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {filteredBoards.map(board => (
            <BoardCard
              key={board.id}
              board={board}
              jobs={jobs || []}
              selected={selectedBoards.includes(board.id)}
              onSelect={() => toggleBoardSelection(board.id)}
              onClick={() => handleBoardClick(board)}
              onRightClick={(e) => handleRightClick(e, board)}
              onViewDetails={handleViewDetails}
              onPauseQueue={handlePauseQueue}
              onResumeQueue={handleResumeQueue}
              onRestart={handleRestartBoard}
              onShutdown={handleShutdownBoard}
            />
      ))}
    </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto overflow-y-hidden">
          <table className="w-full min-w-[640px]">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-6 py-4 text-left">
                  <input
                    type="checkbox"
                    checked={selectedBoards.length === filteredBoards.length && filteredBoards.length > 0}
                    onChange={selectedBoards.length === filteredBoards.length ? clearBoardSelection : selectAllBoards}
                    className="w-4 h-4 rounded border-slate-300 text-blue-600"
                  />
                </th>
                <th className="px-6 py-4 text-left text-xs font-bold text-slate-600 uppercase tracking-wider">Board</th>
                <th className="px-6 py-4 text-left text-xs font-bold text-slate-600 uppercase tracking-wider">Status</th>
                <th className="px-6 py-4 text-left text-xs font-bold text-slate-600 uppercase tracking-wider">IP Address</th>
                <th className="px-6 py-4 text-left text-xs font-bold text-slate-600 uppercase tracking-wider">MAC Address</th>
                <th className="px-6 py-4 text-left text-xs font-bold text-slate-600 uppercase tracking-wider">Model</th>
                <th className="px-6 py-4 text-left text-xs font-bold text-slate-600 uppercase tracking-wider">Firmware</th>
                <th className="px-6 py-4 text-left text-xs font-bold text-slate-600 uppercase tracking-wider">FPGA / ARM</th>
                <th className="px-6 py-4 text-left text-xs font-bold text-slate-600 uppercase tracking-wider">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
              {filteredBoards.map(board => (
                <BoardTableRow
                  key={board.id}
                  board={board}
                  selected={selectedBoards.includes(board.id)}
                  onSelect={() => toggleBoardSelection(board.id)}
                  onClick={() => handleBoardClick(board)}
                  onSSHClick={() => {
                    setSelectedBoard(board);
                    setShowSSH(true);
                  }}
                />
              ))}
        </tbody>
      </table>
    </div>
      )}
      
      {/* Context Menu */}
      {showContextMenu && contextMenu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => {
              setShowContextMenu(false);
              setContextMenu(null);
            }}
          />
          <div
            className="fixed z-50 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl py-2 min-w-[200px]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              onClick={async () => {
                const targetBoards = contextMenu?.boards || [];
                if (targetBoards.length === 0) return;
                if (!window.confirm(`Delete ${targetBoards.length} board(s)?`)) return;
                if (isDeletingSelected) return;
                setIsDeletingSelected(true);
                const success = await deleteBoards(targetBoards);
                setIsDeletingSelected(false);
                if (success) {
                  addToast({ type: 'success', message: 'Boards deleted successfully.' });
                } else {
                  addToast({ type: 'error', message: 'Failed to delete boards.' });
                }
                setShowContextMenu(false);
                setContextMenu(null);
              }}
              className="w-full text-left px-4 py-2 text-sm hover:bg-red-50 dark:hover:bg-red-900/40 text-red-700 dark:text-red-300 flex items-center gap-2"
            >
              <XCircle size={16} />
              Delete Selected
            </button>
            <button
              onClick={() => handleBatchAction('Reboot Selected')}
              className="w-full text-left px-4 py-2 text-sm text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2"
            >
              <RefreshCw size={16} />
              Reboot Selected
            </button>
            <button
              onClick={() => handleBatchAction('Update Firmware')}
              className="w-full text-left px-4 py-2 text-sm hover:bg-slate-50 flex items-center gap-2"
            >
              <Download size={16} />
              Update Firmware
            </button>
            <button
              onClick={() => handleBatchAction('Self-Test')}
              className="w-full text-left px-4 py-2 text-sm hover:bg-slate-50 flex items-center gap-2"
            >
              <Activity size={16} />
              Self-Test
            </button>
          </div>
        </>
      )}
      
      {/* Device Details Side Panel */}
      {showDetails && selectedBoard && (
        <DeviceDetailsPanel
          board={selectedBoard}
          onClose={() => {
            setShowDetails(false);
            setSelectedBoard(null);
          }}
          onSSHClick={() => {
            setShowDetails(false);
            setShowSSH(true);
          }}
        />
      )}
      
      {/* WebSSH Terminal */}
      {showSSH && selectedBoard && (
        <WebSSHTerminal
          board={selectedBoard}
          onClose={() => {
            setShowSSH(false);
            setSelectedBoard(null);
          }}
        />
      )}

      {showAddBoard && (
        <AddBoardModal onClose={() => setShowAddBoard(false)} />
      )}
  </div>
);
};

export default BoardsPage;
