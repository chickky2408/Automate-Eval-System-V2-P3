import React, { useEffect, useState } from 'react';
import {
  Cpu, HardDrive, Thermometer, Terminal, Trash2, X,
  Wifi, WifiOff, Server, Tag, Activity, Clock, Zap, Signal
} from 'lucide-react';
import { useTestStore } from '../../store/useTestStore';
import { formatRelativeTime } from '../../utils/timeFormat';
import api from '../../services/api';
import BoardTelemetryPanel from './BoardTelemetryPanel';

/* ─── Status badge helper ─────────────────────────────────────────────── */
function StatusBadge({ status }) {
  const cfg = {
    online: { bg: '#022c22', border: '#10b981', text: '#34d399', dot: '#10b981', label: 'Online' },
    busy:   { bg: '#0c1a3e', border: '#6366f1', text: '#818cf8', dot: '#6366f1', label: 'Busy'   },
    offline:{ bg: '#1c0d0d', border: '#ef4444', text: '#f87171', dot: '#ef4444', label: 'Offline'},
    error:  { bg: '#1c0d0d', border: '#ef4444', text: '#f87171', dot: '#ef4444', label: 'Error'  },
  };
  const c = cfg[status] || cfg.offline;
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wide"
      style={{ background: c.bg, border: `1px solid ${c.border}`, color: c.text }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ background: c.dot, boxShadow: `0 0 5px ${c.dot}` }}
      />
      {c.label}
    </span>
  );
}

/* ─── Small info chip ─────────────────────────────────────────────────── */
function InfoChip({ icon: Icon, label, value, color = '#64748b' }) {
  return (
    <div
      className="flex items-center gap-2 px-3 py-2 rounded-lg"
      style={{ background: '#0f172a', border: '1px solid #1e293b' }}
    >
      <Icon size={13} style={{ color }} />
      <div className="min-w-0">
        <div className="text-[10px] font-bold uppercase tracking-wide" style={{ color: '#475569' }}>{label}</div>
        <div className="text-xs font-semibold truncate" style={{ color: '#e2e8f0' }}>{value || '—'}</div>
      </div>
    </div>
  );
}

/* ─── Live metric card ────────────────────────────────────────────────── */
function LiveMetricCard({ icon: Icon, label, value, unit, color }) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-1 py-3 rounded-xl"
      style={{ background: '#0f172a', border: `1px solid ${color}30` }}
    >
      <Icon size={16} style={{ color }} />
      <div className="text-xl font-extrabold tabular-nums" style={{ color }}>
        {value}{unit}
      </div>
      <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: '#475569' }}>{label}</div>
    </div>
  );
}

/* ─── Main component ──────────────────────────────────────────────────── */
const DeviceDetailsPanel = ({ board, onClose, onSSHClick }) => {
  const { updateBoardTag, updateBoardConnections, deleteBoard, jobs: storeJobs } = useTestStore();
  const jobs = storeJobs || [];
  const jobId = (board.currentJob || '').replace(/^(Batch|Set) #/, '');
  const currentJob = jobId ? jobs.find(j => j.id === jobId) : null;
  const currentJobLabel = currentJob
    ? `${(currentJob.configName || currentJob.name || 'Job').trim()} · #${currentJob.id}`
    : (board.currentJob || 'Idle');

  const addToast = useTestStore(s => s.addToast);
  const [boardTag, setBoardTag]             = useState(board.tag || '');
  const [connectionsText, setConnectionsText] = useState((board.connections || []).join(', '));
  const [isEditing, setIsEditing]           = useState(false);
  const [isDeleting, setIsDeleting]         = useState(false);
  const [statusDetail, setStatusDetail]     = useState(null);
  const [activeSection, setActiveSection]   = useState('telemetry'); // 'telemetry' | 'info'

  const isOffline = board.status !== 'online' && board.status !== 'busy';

  useEffect(() => {
    setBoardTag(board.tag || '');
    setConnectionsText((board.connections || []).join(', '));
  }, [board]);

  useEffect(() => {
    let cancelled = false;
    api.getBoardStatus(board.id)
      .then(d => { if (!cancelled) setStatusDetail(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [board.id]);

  const cpuVal  = statusDetail?.cpu_load  != null ? Number(statusDetail.cpu_load).toFixed(1)  : null;
  const ramVal  = statusDetail?.ram_usage != null ? Number(statusDetail.ram_usage).toFixed(1) : null;
  const tempVal = statusDetail?.cpu_temp  != null ? Number(statusDetail.cpu_temp).toFixed(1)  : null;

  return (
    <>
      {/* ── Backdrop ── */}
      <div
        className="fixed inset-0 z-50"
        style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
        onClick={onClose}
      />

      {/* ── Main canvas modal ── */}
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{ pointerEvents: 'none' }}
      >
        <div
          className="relative flex flex-col w-full max-w-5xl max-h-[92vh] rounded-2xl overflow-hidden"
          style={{
            pointerEvents: 'all',
            background: '#0f172a',
            border: '1px solid #1e293b',
            boxShadow: '0 32px 80px rgba(0,0,0,0.7), 0 0 0 1px #0f172a',
          }}
        >
          {/* ─── Header ─────────────────────────────────────────────── */}
          <div
            className="flex items-center justify-between px-6 py-4 shrink-0"
            style={{ borderBottom: '1px solid #1e293b', background: '#080f1f' }}
          >
            <div className="flex items-center gap-3 min-w-0">
              {/* Board icon */}
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: '#1e293b' }}
              >
                <Server size={18} style={{ color: '#94a3b8' }} />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-base font-extrabold tracking-tight" style={{ color: '#f1f5f9' }}>
                    {board.name}
                  </h2>
                  <StatusBadge status={board.status} />
                  {board.tag && (
                    <span
                      className="text-xs px-2 py-0.5 rounded-full font-semibold"
                      style={{ background: '#1e293b', color: '#94a3b8' }}
                    >
                      {board.tag}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-0.5 text-[11px]" style={{ color: '#475569' }}>
                  <span>{board.model || 'Unknown model'}</span>
                  <span>·</span>
                  <span>{board.ip}</span>
                  <span>·</span>
                  <span>FW: {board.firmware || '—'}</span>
                  {board.fpgaStatus && (
                    <>
                      <span>·</span>
                      <span>
                        FPGA: <strong style={{ color: board.fpgaStatus === 'active' ? '#10b981' : '#ef4444' }}>
                          {board.fpgaStatus}
                        </strong>
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Close */}
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors"
              style={{ background: '#1e293b', color: '#64748b' }}
              onMouseEnter={e => e.currentTarget.style.background = '#334155'}
              onMouseLeave={e => e.currentTarget.style.background = '#1e293b'}
            >
              <X size={16} />
            </button>
          </div>

          {/* ─── Live metric cards row ───────────────────────────────── */}
          <div
            className="grid grid-cols-3 gap-3 px-6 py-3 shrink-0"
            style={{ borderBottom: '1px solid #1e293b', background: '#080f1f' }}
          >
            <LiveMetricCard
              icon={Cpu}
              label="CPU Load"
              value={cpuVal ?? '—'}
              unit={cpuVal != null ? '%' : ''}
              color="#10b981"
            />
            <LiveMetricCard
              icon={HardDrive}
              label="Memory"
              value={ramVal ?? '—'}
              unit={ramVal != null ? '%' : ''}
              color="#818cf8"
            />
            <LiveMetricCard
              icon={Thermometer}
              label="CPU Temp"
              value={tempVal ?? '—'}
              unit={tempVal != null ? '°C' : ''}
              color="#fb923c"
            />
          </div>

          {/* ─── Tab bar ────────────────────────────────────────────── */}
          <div
            className="flex items-center gap-1 px-6 pt-3 pb-0 shrink-0"
            style={{ borderBottom: '1px solid #1e293b' }}
          >
            {[
              { key: 'telemetry', label: 'Performance', icon: Activity },
              { key: 'info',      label: 'Board Info',  icon: Server    },
            ].map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setActiveSection(key)}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-t-lg border-b-2 transition-all"
                style={{
                  borderBottomColor: activeSection === key ? '#6366f1' : 'transparent',
                  color: activeSection === key ? '#818cf8' : '#475569',
                  background: activeSection === key ? '#1e293b40' : 'transparent',
                }}
              >
                <Icon size={13} />
                {label}
              </button>
            ))}
          </div>

          {/* ─── Body (scrollable) ───────────────────────────────────── */}
          <div className="flex-1 overflow-y-auto px-6 py-4">

            {activeSection === 'telemetry' && (
              <BoardTelemetryPanel boardId={board.id} isOffline={isOffline} />
            )}

            {activeSection === 'info' && (
              <div className="flex flex-col gap-6">

                {/* Network */}
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: '#475569' }}>
                    Network
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <InfoChip icon={Wifi}   label="IP Address"  value={board.ip}  color="#38bdf8" />
                    <InfoChip icon={Signal} label="MAC Address" value={board.mac} color="#38bdf8" />
                    <InfoChip icon={Clock}  label="Last Online" value={board.lastHeartbeat ? formatRelativeTime(board.lastHeartbeat) : '—'} color="#38bdf8" />
                    <InfoChip icon={Zap}    label="Voltage"     value={board.voltage != null ? `${board.voltage} V` : '—'} color="#f59e0b" />
                  </div>
                </div>

                {/* Device */}
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: '#475569' }}>
                    Device
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <InfoChip icon={Server}    label="Model"    value={board.model}    color="#a78bfa" />
                    <InfoChip icon={Clock}     label="Firmware" value={board.firmware} color="#a78bfa" />
                    <InfoChip icon={Activity}  label="Current Job" value={currentJobLabel} color="#64748b" />
                    <InfoChip icon={Cpu}       label="ARM Status"  value={board.armStatus}  color={board.armStatus === 'online' ? '#10b981' : '#ef4444'} />
                  </div>
                </div>

                {/* Tag & Connections */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#475569' }}>
                      Tag & Connections
                    </div>
                    {!isEditing ? (
                      <button
                        onClick={() => setIsEditing(true)}
                        className="text-xs font-bold px-2 py-1 rounded transition-colors"
                        style={{ color: '#6366f1', background: '#1e1b4b40' }}
                      >
                        Edit
                      </button>
                    ) : (
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            updateBoardTag(board.id, boardTag.trim());
                            const parsed = connectionsText.split(',').map(s => s.trim()).filter(Boolean);
                            updateBoardConnections(board.id, parsed);
                            setIsEditing(false);
                          }}
                          className="text-xs font-bold px-2 py-1 rounded"
                          style={{ color: '#10b981', background: '#022c2240' }}
                        >
                          Save
                        </button>
                        <button
                          onClick={() => {
                            setBoardTag(board.tag || '');
                            setConnectionsText((board.connections || []).join(', '));
                            setIsEditing(false);
                          }}
                          className="text-xs font-bold px-2 py-1 rounded"
                          style={{ color: '#64748b', background: '#1e293b40' }}
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-2">
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-wide block mb-1" style={{ color: '#475569' }}>
                        Board Tag
                      </label>
                      <input
                        disabled={!isEditing}
                        value={boardTag}
                        onChange={e => setBoardTag(e.target.value)}
                        placeholder="e.g., Line A, RMA, testing..."
                        className="w-full px-3 py-2 rounded-lg text-sm outline-none transition-all"
                        style={{
                          background: '#0f172a',
                          border: `1px solid ${isEditing ? '#6366f1' : '#1e293b'}`,
                          color: '#e2e8f0',
                          opacity: isEditing ? 1 : 0.75,
                        }}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-wide block mb-1" style={{ color: '#475569' }}>
                        Connections / Capabilities
                      </label>
                      <input
                        disabled={!isEditing}
                        value={connectionsText}
                        onChange={e => setConnectionsText(e.target.value)}
                        placeholder="comma separated (e.g., REST API, SSH, HTTP)"
                        className="w-full px-3 py-2 rounded-lg text-sm outline-none transition-all"
                        style={{
                          background: '#0f172a',
                          border: `1px solid ${isEditing ? '#6366f1' : '#1e293b'}`,
                          color: '#e2e8f0',
                          opacity: isEditing ? 1 : 0.75,
                        }}
                      />
                    </div>
                    {(board.connections || []).length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {(board.connections || []).map((c, i) => (
                          <span
                            key={i}
                            className="px-2 py-0.5 rounded-full text-xs font-bold"
                            style={{ background: '#1e293b', color: '#94a3b8' }}
                          >
                            {c}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ─── Footer actions ──────────────────────────────────────── */}
          <div
            className="flex items-center justify-between px-6 py-4 shrink-0"
            style={{ borderTop: '1px solid #1e293b', background: '#080f1f' }}
          >
            <button
              onClick={async () => {
                if (!window.confirm(`Delete board "${board.name || board.id}"? This cannot be undone.`)) return;
                if (isDeleting) return;
                setIsDeleting(true);
                const success = await deleteBoard(board.id);
                setIsDeleting(false);
                if (success) {
                  addToast({ type: 'success', message: 'Board deleted.' });
                  onClose();
                } else {
                  addToast({ type: 'error', message: 'Failed to delete board.' });
                }
              }}
              disabled={isDeleting}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all"
              style={{
                background: '#1c0d0d',
                border: '1px solid #7f1d1d',
                color: isDeleting ? '#64748b' : '#f87171',
                cursor: isDeleting ? 'not-allowed' : 'pointer',
              }}
            >
              <Trash2 size={14} />
              {isDeleting ? 'Deleting...' : 'Delete Board'}
            </button>

            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-lg text-sm font-bold transition-all"
                style={{ background: '#1e293b', color: '#94a3b8', border: '1px solid #334155' }}
                onMouseEnter={e => e.currentTarget.style.background = '#334155'}
                onMouseLeave={e => e.currentTarget.style.background = '#1e293b'}
              >
                Close
              </button>
              <button
                onClick={onSSHClick}
                className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-bold transition-all"
                style={{ background: '#4f46e5', color: '#fff', border: '1px solid #6366f1' }}
                onMouseEnter={e => e.currentTarget.style.background = '#6366f1'}
                onMouseLeave={e => e.currentTarget.style.background = '#4f46e5'}
              >
                <Terminal size={15} />
                SSH Terminal
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default DeviceDetailsPanel;
