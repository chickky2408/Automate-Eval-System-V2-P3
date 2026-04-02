import React, { useEffect, useRef, useState } from 'react';
import { Activity, AlertCircle, CheckCircle2, ChevronDown, ChevronUp, Clock, Copy, Eye, MoreVertical, Pause, Play, RefreshCw, Search, Settings, Square, Tag, Terminal, Trash2, Wifi, WifiOff, X, XCircle } from 'lucide-react';

const BoardCard = ({ board, jobs = [], selected, onSelect, onClick, onRightClick, onViewDetails, onPauseQueue, onResumeQueue, onRestart, onShutdown }) => {
  const jobId = (board.currentJob || '').replace(/^(Batch|Set) #/, '');
  const currentJob = jobId ? (jobs || []).find(j => j.id === jobId) : null;
  const currentJobLabel = currentJob
    ? `${(currentJob.configName || currentJob.name || 'Set').trim()} · ID #${currentJob.id}`
    : (board.currentJob || 'Idle');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    if (menuOpen) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [menuOpen]);

  const getStatusColor = (status) => {
    switch(status) {
      case 'online': return 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800';
      case 'busy': return 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800';
      case 'error': return 'bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800';
      default: return 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-600';
    }
  };
  
  return (
    <div
      className={`bg-white p-4 rounded-xl border-2 transition-all hover:shadow-lg cursor-pointer relative ${
        board.status === 'error' 
          ? 'border-red-200 bg-red-50/20 dark:border-slate-600 dark:bg-slate-800' 
          : board.status === 'busy'
          ? 'border-blue-200 bg-blue-50/10 dark:border-slate-600 dark:bg-slate-800'
          : 'border-emerald-200 bg-white dark:border-slate-700 dark:bg-slate-800'
      } ${selected ? 'ring-2 ring-blue-500' : ''}`}
      onClick={onClick}
      onContextMenu={onRightClick}
    >
      <div className="absolute top-3 right-3 flex items-center gap-2 flex-nowrap" ref={menuRef}>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
          className="p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 transition-colors"
          title="เมนูบอร์ด"
          aria-label="Board menu"
        >
          <Settings size={16} />
        </button>
        <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${getStatusColor(board.status)}`}>
          {board.status}
        </span>
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => {
            e.stopPropagation();
            onSelect();
          }}
          onClick={(e) => e.stopPropagation()}
          className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-blue-600"
        />
        {menuOpen && (
          <div
            className="absolute right-0 top-full mt-1 w-56 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 shadow-xl z-50 py-1"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => { onViewDetails?.(board); setMenuOpen(false); }}
              className="w-full text-left px-4 py-2 text-sm text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2"
            >
              <Eye size={16} className="text-slate-500" />
              View Logs / Details
            </button>
            <button
              type="button"
              onClick={() => { (board.queuePaused ? onResumeQueue : onPauseQueue)?.(board); setMenuOpen(false); }}
              className="w-full text-left px-4 py-2 text-sm text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2"
            >
              {board.queuePaused ? <Play size={16} className="text-slate-500" /> : <Pause size={16} className="text-slate-500" />}
              {board.queuePaused ? 'Resume Queue' : 'Pause Queue'}
            </button>
            <div className="border-t border-slate-200 dark:border-slate-700 my-1" />
            <button
              type="button"
              onClick={() => { onRestart?.(board); setMenuOpen(false); }}
              className="w-full text-left px-4 py-2 text-sm text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/30 flex items-center gap-2 font-medium"
            >
              <RefreshCw size={16} />
              Restart Board
            </button>
            <button
              type="button"
              onClick={() => { onShutdown?.(board); setMenuOpen(false); }}
              className="w-full text-left px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 flex items-center gap-2 font-medium"
            >
              <XCircle size={16} />
              Shutdown Board
            </button>
          </div>
        )}
      </div>
      
      <div className="flex justify-between items-center mb-4 min-w-0">
        <div className="min-w-0 flex items-center gap-2">
          <span className="font-bold text-slate-800 dark:text-slate-100 text-base">#{board.id}</span>
          {board.tag && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300 shrink-0">
              {board.tag}
            </span>
          )}
        </div>
      </div>
      
      <div className="space-y-1.5 text-xs">
        <div className="flex justify-between">
          <span className="text-slate-400 dark:text-slate-500">IP:</span>
          <span className="font-bold text-slate-800 dark:text-slate-200">{board.ip}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400 dark:text-slate-500">Model:</span>
          <span className="font-bold text-slate-800 dark:text-slate-200">{board.model}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400 dark:text-slate-500">Firmware:</span>
          <span className="font-bold text-slate-800 dark:text-slate-200">{board.firmware}</span>
        </div>
        {(board.fpgaStatus || board.armStatus) && (
          <div className="flex justify-between gap-2">
            <span className="text-slate-400 dark:text-slate-500">FPGA / ARM:</span>
            <span className="font-bold text-slate-800 dark:text-slate-200 flex gap-1.5">
              <span className={board.fpgaStatus === 'active' ? 'text-emerald-600' : board.fpgaStatus === 'error' ? 'text-red-600' : 'text-slate-500'} title="FPGA">{board.fpgaStatus || '—'}</span>
              <span className="text-slate-400">/</span>
              <span className={board.armStatus === 'online' ? 'text-emerald-600' : board.armStatus === 'busy' ? 'text-blue-600' : board.armStatus === 'error' ? 'text-red-600' : 'text-slate-500'} title="ARM">{board.armStatus || '—'}</span>
            </span>
          </div>
        )}
        {board.lastHeartbeat && (
          <div className="flex justify-between">
            <span className="text-slate-400 dark:text-slate-500">Last heartbeat:</span>
            <span className="font-bold text-slate-800 dark:text-slate-200 text-[10px]" title={board.lastHeartbeat}>
              {new Date(board.lastHeartbeat).toLocaleTimeString()}
            </span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-slate-400 dark:text-slate-500">Current Job:</span>
          <span className="font-bold text-slate-800 dark:text-slate-200 truncate max-w-[60%]" title={currentJobLabel}>{currentJobLabel}</span>
        </div>
        {board.connections && board.connections.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1">
            {board.connections.slice(0, 3).map((c, idx) => (
              <span key={idx} className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300">{c}</span>
            ))}
            {board.connections.length > 3 && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">+{board.connections.length - 3}</span>
            )}
          </div>
        )}
        {board.voltage && (
          <div className="flex justify-between">
            <span className="text-slate-400 dark:text-slate-500">Voltage:</span>
            <span className="font-bold text-slate-800 dark:text-slate-200">{board.voltage}V</span>
          </div>
        )}
      </div>
    </div>
  );
};

// Board Table Row (List View)

export default BoardCard;
