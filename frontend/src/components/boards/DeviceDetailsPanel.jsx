import React, { useEffect, useState } from 'react';
import { Activity, AlertCircle, CheckCircle2, Clock, Cpu, Database, Download, Eye, HardDrive, Monitor, Pause, Play, RefreshCw, Settings, Square, Tag, Terminal, Trash2, Wifi, WifiOff, X } from 'lucide-react';
import { useTestStore } from '../../store/useTestStore';
import api from '../../services/api';

const DeviceDetailsPanel = ({ board, onClose, onSSHClick }) => {
  const { updateBoardTag, updateBoardConnections, deleteBoard, jobs: storeJobs } = useTestStore();
  const jobs = storeJobs || [];
  const jobId = (board.currentJob || '').replace(/^(Batch|Set) #/, '');
  const currentJob = jobId ? jobs.find(j => j.id === jobId) : null;
  const currentJobLabel = currentJob
    ? `${(currentJob.configName || currentJob.name || 'Set').trim()} · ID #${currentJob.id}`
    : (board.currentJob || 'Idle');
  const addToast = useTestStore((state) => state.addToast);
  const [boardTag, setBoardTag] = useState(board.tag || '');
  const [connectionsText, setConnectionsText] = useState((board.connections || []).join(', '));
  const [isEditing, setIsEditing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [statusDetail, setStatusDetail] = useState(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [availability, setAvailability] = useState('available');

  useEffect(() => {
    setBoardTag(board.tag || '');
    setConnectionsText((board.connections || []).join(', '));
    setAvailability(board.isDisabled ? 'disabled' : 'available');
  }, [board]);

  useEffect(() => {
    let cancelled = false;
    setStatusLoading(true);
    setStatusDetail(null);
    api.getBoardStatus(board.id)
      .then((data) => { if (!cancelled) setStatusDetail(data); })
      .catch(() => { if (!cancelled) setStatusDetail(null); })
      .finally(() => { if (!cancelled) setStatusLoading(false); });
    return () => { cancelled = true; };
  }, [board.id]);

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-50" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-[500px] bg-white dark:bg-slate-900 shadow-2xl z-50 overflow-y-auto">
        <div className="p-6 border-b border-slate-200 dark:border-slate-700 sticky top-0 bg-white dark:bg-slate-900">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{board.name} Details</h2>
            <button onClick={onClose} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-600 dark:text-slate-400">
              <X size={24} />
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-block px-3 py-1 rounded-full text-xs font-bold uppercase ${
              board.status === 'online' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300' :
              board.status === 'busy' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300' :
              'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300'
            }`}>
              {board.status}
            </span>
            {(board.fpgaStatus || board.armStatus) && (
              <span className="text-xs text-slate-500 dark:text-slate-400">
                FPGA: <strong className={board.fpgaStatus === 'active' ? 'text-emerald-600' : board.fpgaStatus === 'error' ? 'text-red-600' : 'text-slate-600'}>{board.fpgaStatus || '—'}</strong>
                {' · '}
                ARM: <strong className={board.armStatus === 'online' ? 'text-emerald-600' : board.armStatus === 'busy' ? 'text-blue-600' : board.armStatus === 'error' ? 'text-red-600' : 'text-slate-600'}>{board.armStatus || '—'}</strong>
              </span>
            )}
          </div>
        </div>
        
        <div className="p-6 space-y-6">
          {/* RAM / Storage / CPU (from GET /boards/:id/status - existing backend) */}
          <div className="bg-slate-50 dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
            <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 uppercase mb-3">System resources</h3>
            {statusLoading ? (
              <div className="text-sm text-slate-500 dark:text-slate-400">กำลังโหลด...</div>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-600 text-center">
                  <div className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wide">RAM</div>
                  <div className="text-lg font-bold text-slate-800 dark:text-slate-200 mt-1">
                    {statusDetail?.ram_usage != null ? `${Math.round(Number(statusDetail.ram_usage))}%` : '—'}
                  </div>
                </div>
                <div className="p-3 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-600 text-center">
                  <div className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wide">Storage</div>
                  <div className="text-lg font-bold text-slate-800 dark:text-slate-200 mt-1">
                    {statusDetail?.storage_usage != null
                      ? `${Math.round(Number(statusDetail.storage_usage))}%`
                      : '—'}
                  </div>
                </div>
                <div className="p-3 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-600 text-center">
                  <div className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wide">CPU</div>
                  <div className="text-lg font-bold text-slate-800 dark:text-slate-200 mt-1">
                    {statusDetail?.cpu_load != null ? `${Math.round(Number(statusDetail.cpu_load))}%` : '—'}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="bg-slate-50 dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300">Tag & Connections</h3>
              <span className={`text-xs font-bold px-2 py-1 rounded-full mr-auto ml-3 ${
                availability === 'available'
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-slate-200 text-slate-700'
              }`}>
                {availability === 'available' ? 'Available' : 'Disabled'}
              </span>
              {!isEditing ? (
                <button
                  onClick={() => setIsEditing(true)}
                  className="text-xs font-bold text-blue-600 hover:text-blue-800"
                >
                  Edit
                </button>
              ) : (
                <div className="flex gap-2 items-center">
                  <div className="flex gap-1 mr-4">
                    <button
                      type="button"
                      onClick={() => setAvailability('available')}
                      className={`px-2 py-1 rounded-full text-[10px] font-bold border ${
                        availability === 'available'
                          ? 'bg-emerald-100 text-emerald-700 border-emerald-300'
                          : 'bg-white text-slate-600 border-slate-300'
                      }`}
                    >
                      Available
                    </button>
                    <button
                      type="button"
                      onClick={() => setAvailability('disabled')}
                      className={`px-2 py-1 rounded-full text-[10px] font-bold border ${
                        availability === 'disabled'
                          ? 'bg-slate-200 text-slate-800 border-slate-400'
                          : 'bg-white text-slate-600 border-slate-300'
                      }`}
                    >
                      Disabled
                    </button>
                  </div>
                  <button
                    onClick={() => {
                      updateBoardTag(board.id, boardTag.trim());
                      const parsed = connectionsText.split(',').map(s => s.trim()).filter(Boolean);
                      updateBoardConnections(board.id, parsed);
                      setIsEditing(false);
                    }}
                    className="text-xs font-bold text-emerald-700 hover:text-emerald-900"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => {
                      setBoardTag(board.tag || '');
                      setConnectionsText((board.connections || []).join(', '));
                      setIsEditing(false);
                    }}
                    className="text-xs font-bold text-slate-600 hover:text-slate-900"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
            <div className="space-y-3">
              <div>
                <div className="text-xs font-bold text-slate-400 uppercase mb-1">Board Tag</div>
                <input
                  disabled={!isEditing}
                  value={boardTag}
                  onChange={(e) => setBoardTag(e.target.value)}
                  placeholder="e.g., Line A, RMA, etc."
                  className={`w-full bg-white border border-slate-200 p-3 rounded-xl outline-none ${isEditing ? 'focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500' : 'opacity-80'}`}
                />
              </div>
              <div>
                <div className="text-xs font-bold text-slate-400 uppercase mb-1">Connections / Capabilities</div>
                <input
                  disabled={!isEditing}
                  value={connectionsText}
                  onChange={(e) => setConnectionsText(e.target.value)}
                  placeholder="comma separated (e.g., REST API, SSH, HTTP)"
                  className={`w-full bg-white border border-slate-200 p-3 rounded-xl outline-none ${isEditing ? 'focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500' : 'opacity-80'}`}
                />
                <div className="text-xs text-slate-400 mt-1">แสดงว่าบอร์ดนี้ “connect ได้กับอะไร” เพื่อให้ทีมไม่สับสน</div>
              </div>
              {(board.connections || []).length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {(board.connections || []).map((c, idx) => (
                    <span key={idx} className="px-2 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-700">{c}</span>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-bold text-slate-400 uppercase mb-3">Network Information</h3>
            <div className="space-y-2">
              <div className="flex justify-between p-3 bg-slate-50 rounded-lg">
                <span className="text-slate-600">IP Address</span>
                <span className="font-bold">{board.ip}</span>
              </div>
              <div className="flex justify-between p-3 bg-slate-50 rounded-lg">
                <span className="text-slate-600">MAC Address</span>
                <span className="font-mono font-bold">{board.mac}</span>
              </div>
            </div>
          </div>
          
          <div>
            <h3 className="text-sm font-bold text-slate-400 uppercase mb-3">Device Information</h3>
            <div className="space-y-2">
              <div className="flex justify-between p-3 bg-slate-50 rounded-lg">
                <span className="text-slate-600">Model</span>
                <span className="font-bold">{board.model}</span>
              </div>
              <div className="flex justify-between p-3 bg-slate-50 rounded-lg">
                <span className="text-slate-600">Firmware Version</span>
                <span className="font-bold">{board.firmware}</span>
              </div>
              <div className="flex justify-between p-3 bg-slate-50 rounded-lg">
                <span className="text-slate-600">Current Job</span>
                <span className="font-bold truncate max-w-[70%]" title={currentJobLabel}>{currentJobLabel}</span>
              </div>
            </div>
          </div>
          
          <div>
            <h3 className="text-sm font-bold text-slate-400 uppercase mb-3">Telemetry</h3>
            <div className="space-y-2">
              {board.voltage !== null && (
                <div className="flex justify-between p-3 bg-slate-50 rounded-lg">
                  <span className="text-slate-600">Voltage</span>
                  <span className="font-bold">{board.voltage}V</span>
                </div>
              )}
              {board.signal !== null && (
                <div className="flex justify-between p-3 bg-slate-50 rounded-lg">
                  <span className="text-slate-600">Signal Strength</span>
                  <span className="font-bold">{board.signal} dBm</span>
                </div>
              )}
              {board.temp !== null && (
                <div className="flex justify-between p-3 bg-slate-50 rounded-lg">
                  <span className="text-slate-600">Temperature</span>
                  <span className="font-bold">{board.temp}°C</span>
                </div>
              )}
            </div>
          </div>
          
          <div className="flex gap-3 pt-4 border-t border-slate-200">
            <button
              onClick={async () => {
                if (!window.confirm(`Delete ${board.name || board.id}?`)) return;
                if (isDeleting) return;
                setIsDeleting(true);
                const success = await deleteBoard(board.id);
                setIsDeleting(false);
                if (success) {
                  addToast({ type: 'success', message: 'Board deleted successfully.' });
                  onClose();
                } else {
                  addToast({ type: 'error', message: 'Failed to delete board.' });
                }
              }}
              disabled={isDeleting}
              className={`px-4 py-3 bg-red-50 text-red-700 rounded-lg font-bold transition-all ${isDeleting ? 'opacity-60 cursor-not-allowed' : 'hover:bg-red-100'}`}
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </button>
            <button
              onClick={onSSHClick}
              className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 transition-all flex items-center justify-center gap-2"
            >
              <Terminal size={18} />
              Open SSH Terminal
            </button>
            <button
              onClick={onClose}
              className="px-4 py-3 bg-slate-100 text-slate-700 rounded-lg font-bold hover:bg-slate-200 transition-all"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

// WebSSH Terminal

export default DeviceDetailsPanel;
