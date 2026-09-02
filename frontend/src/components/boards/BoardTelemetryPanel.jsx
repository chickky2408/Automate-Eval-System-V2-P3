import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Activity, Cpu, HardDrive, Thermometer, RefreshCw, Clock } from 'lucide-react';
import api from '../../services/api';

const POLLING_INTERVAL = 3000; // 3 seconds
const MAX_POINTS = 60;

// ---- Single subplot SVG chart ----
function SubplotChart({ history, dataKey, label, color, gradientId, unit, yMax }) {
  const W = 800;
  const H = 120;
  const PL = 44; // padding left (Y-axis labels)
  const PR = 12;
  const PT = 10;
  const PB = 28; // padding bottom (X-axis time labels)

  const chartW = W - PL - PR;
  const chartH = H - PT - PB;

  const n = history.length;

  // Generate SVG line path
  const linePath = useMemo(() => {
    if (n < 2) return '';
    const pts = history.map((pt, i) => {
      const val = pt[dataKey] ?? 0;
      const x = PL + (i / (MAX_POINTS - 1)) * chartW;
      const clamped = Math.max(0, Math.min(yMax, val));
      const y = PT + chartH - (clamped / yMax) * chartH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return `M ${pts.join(' L ')}`;
  }, [history, dataKey, yMax]);

  // Area fill path
  const areaPath = useMemo(() => {
    if (n < 2) return '';
    const pts = history.map((pt, i) => {
      const val = pt[dataKey] ?? 0;
      const x = PL + (i / (MAX_POINTS - 1)) * chartW;
      const clamped = Math.max(0, Math.min(yMax, val));
      const y = PT + chartH - (clamped / yMax) * chartH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const startX = PL;
    const endX = PL + ((n - 1) / (MAX_POINTS - 1)) * chartW;
    const bottomY = PT + chartH;
    return `M ${startX},${bottomY} L ${pts.join(' L ')} L ${endX},${bottomY} Z`;
  }, [history, dataKey, yMax]);

  // Y-axis grid lines (5 lines)
  const yLines = [0, 25, 50, 75, 100].map(pct => {
    const val = (pct / 100) * yMax;
    const y = PT + chartH - (pct / 100) * chartH;
    return { y, label: Math.round(val) };
  });

  // X-axis time labels — show timestamps from history
  const xLabels = useMemo(() => {
    if (n < 2) return [];
    const indices = [0, Math.floor(n / 4), Math.floor(n / 2), Math.floor((3 * n) / 4), n - 1];
    return indices.map(i => {
      const pt = history[i];
      if (!pt || !pt.recorded_at) return null;
      const d = new Date(pt.recorded_at);
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      const ss = String(d.getSeconds()).padStart(2, '0');
      const x = PL + (i / (MAX_POINTS - 1)) * chartW;
      return { x, label: `${hh}:${mm}:${ss}` };
    }).filter(Boolean);
  }, [history]);

  // Latest value
  const latestVal = n > 0 ? (history[n - 1][dataKey] ?? 0) : 0;

  return (
    <div className="relative">
      {/* Header row */}
      <div className="flex items-center justify-between mb-1 px-1">
        <div className="flex items-center gap-2">
          <span
            className="inline-block w-2.5 h-2.5 rounded-full"
            style={{ background: color, boxShadow: `0 0 6px ${color}80` }}
          />
          <span className="text-xs font-bold tracking-wide" style={{ color }}>
            {label}
          </span>
        </div>
        <span className="text-lg font-extrabold tabular-nums" style={{ color }}>
          {latestVal.toFixed(1)}{unit}
        </span>
      </div>

      {/* SVG Chart */}
      <div className="w-full overflow-hidden rounded-lg" style={{ background: '#0f172a', border: '1px solid #1e293b' }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="w-full"
          style={{ height: 120 }}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.30" />
              <stop offset="100%" stopColor={color} stopOpacity="0.02" />
            </linearGradient>
            <filter id={`glow-${gradientId}`} x="-10%" y="-10%" width="120%" height="120%">
              <feGaussianBlur stdDeviation="2" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>

          {/* Y-axis grid lines */}
          {yLines.map(({ y, label: yLabel }) => (
            <g key={y}>
              <line
                x1={PL} y1={y} x2={W - PR} y2={y}
                stroke="#334155" strokeWidth={0.5} strokeDasharray="3 4"
              />
              <text
                x={PL - 6} y={y + 4}
                fill="#475569" fontSize="9" textAnchor="end"
                fontFamily="monospace"
              >
                {yLabel}{unit === '°C' ? '' : '%'}
              </text>
            </g>
          ))}

          {/* Chart border lines */}
          <line x1={PL} y1={PT} x2={PL} y2={PT + chartH} stroke="#334155" strokeWidth={1} />
          <line x1={PL} y1={PT + chartH} x2={W - PR} y2={PT + chartH} stroke="#334155" strokeWidth={1} />

          {/* Area fill */}
          {areaPath && (
            <path d={areaPath} fill={`url(#${gradientId})`} />
          )}

          {/* Line */}
          {linePath && (
            <path
              d={linePath}
              fill="none"
              stroke={color}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              filter={`url(#glow-${gradientId})`}
            />
          )}

          {/* Latest value dot */}
          {n >= 1 && (() => {
            const val = history[n - 1][dataKey] ?? 0;
            const x = PL + ((n - 1) / (MAX_POINTS - 1)) * chartW;
            const clamped = Math.max(0, Math.min(yMax, val));
            const y = PT + chartH - (clamped / yMax) * chartH;
            return (
              <g>
                <circle cx={x} cy={y} r={4} fill={color} opacity={0.3} />
                <circle cx={x} cy={y} r={2.5} fill={color} />
              </g>
            );
          })()}

          {/* X-axis time labels */}
          {xLabels.map(({ x, label: xLabel }, i) => (
            <text
              key={i}
              x={x} y={PT + chartH + 16}
              fill="#475569" fontSize="8.5"
              textAnchor={i === 0 ? 'start' : i === xLabels.length - 1 ? 'end' : 'middle'}
              fontFamily="monospace"
            >
              {xLabel}
            </text>
          ))}
        </svg>
      </div>
    </div>
  );
}

// ---- Main Telemetry Panel ----
export default function BoardTelemetryPanel({ boardId, isOffline }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const timerRef = useRef(null);

  const fetchTelemetry = async (isInitial = false) => {
    try {
      if (isOffline) {
        setHistory([]);
        setLoading(false);
        return;
      }
      const data = await api.getBoardTelemetry(boardId);
      if (Array.isArray(data)) {
        setHistory(data.slice(-MAX_POINTS));
      }
    } catch (err) {
      console.error('Failed to fetch board telemetry:', err);
    } finally {
      if (isInitial) setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    fetchTelemetry(true);
    timerRef.current = setInterval(() => fetchTelemetry(false), POLLING_INTERVAL);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [boardId, isOffline]);

  const currentPoint = useMemo(() => {
    return history.length > 0 ? history[history.length - 1] : { cpu_load: 0, ram_usage: 0, cpu_temp: 0 };
  }, [history]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3" style={{ color: '#64748b' }}>
        <RefreshCw size={22} className="animate-spin" />
        <span className="text-xs font-medium">Loading telemetry data...</span>
      </div>
    );
  }

  if (isOffline || history.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center py-12 gap-2 rounded-xl"
        style={{ border: '1px dashed #334155', background: '#0f172a40' }}
      >
        <Activity size={28} style={{ color: '#475569' }} />
        <span className="text-xs font-bold" style={{ color: '#64748b' }}>Telemetry Unavailable</span>
        <p className="text-[11px]" style={{ color: '#475569' }}>
          Board must be online to stream resource data.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Live indicator + time range */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse inline-block" />
          <span className="text-xs font-bold text-emerald-400">LIVE</span>
          <span className="text-xs text-slate-500 ml-1">· updates every 3s</span>
        </div>
        <div className="flex items-center gap-1 text-xs text-slate-500">
          <Clock size={11} />
          <span>{history.length} data points</span>
        </div>
      </div>

      {/* CPU subplot */}
      <SubplotChart
        history={history}
        dataKey="cpu_load"
        label="CPU Load"
        color="#10b981"
        gradientId="grad-cpu-sub"
        unit="%"
        yMax={100}
      />

      {/* RAM subplot */}
      <SubplotChart
        history={history}
        dataKey="ram_usage"
        label="Memory (RAM)"
        color="#818cf8"
        gradientId="grad-ram-sub"
        unit="%"
        yMax={100}
      />

      {/* Temperature subplot */}
      <SubplotChart
        history={history}
        dataKey="cpu_temp"
        label="CPU Temperature"
        color="#fb923c"
        gradientId="grad-temp-sub"
        unit="°C"
        yMax={100}
      />
    </div>
  );
}
