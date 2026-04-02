import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  Eye,
  Gauge,
  Pause,
  Play,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useTestStore } from '../store/useTestStore';
import API_ENDPOINTS from '../utils/apiEndpoints';

const MAX_WAVEFORM_SAMPLES = 3000;
const DISPLAY_WAVEFORM_SAMPLES = 800;
const WAVEFORM_CANVAS_HEIGHT = 320;

const WaveformPage = () => {
  const boards = useTestStore((state) => state.boards || []);
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const bufferRef = useRef({ CH1: [], CH2: [], CH3: [], CH4: [] });
  const rafRef = useRef(null);
  const wsRef = useRef(null);
  const connectedRef = useRef(false);
  const fsRef = useRef(4000);
  const showWaveformRef = useRef(true);
  const showPlayheadRef = useRef(true);
  const playheadFracRef = useRef(0); // remember last running position (0..1)
  const showGridRef = useRef(true);
  const visibleSignalsRef = useRef({ ch1: true, ch2: true, ch3: true, ch4: true });
  const [connected, setConnected] = useState(false);
  const [meta, setMeta] = useState({ freq_hz: 125000, fs: 4000 });
  const [lastChunkAt, setLastChunkAt] = useState(null);
  const [sampleCount, setSampleCount] = useState(0);
  const [runProgress, setRunProgress] = useState(0);
  const [showWaveform, setShowWaveform] = useState(true);
  const [showPlayhead, setShowPlayhead] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [showStats, setShowStats] = useState(true);
  const [zoomLevel, setZoomLevel] = useState(1);
  const zoomLevelRef = useRef(1);
  const [containerWidth, setContainerWidth] = useState(800);
  const [scaleMode, setScaleMode] = useState('manual');
  const [yMinManual, setYMinManual] = useState(-1);
  const [yMaxManual, setYMaxManual] = useState(1);
  const scaleModeRef = useRef(scaleMode);
  const yMinManualRef = useRef(yMinManual);
  const yMaxManualRef = useRef(yMaxManual);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const [scrollOffset, setScrollOffset] = useState(0);
  const scrollOffsetRef = useRef(0);
  const [viewPanelOpen, setViewPanelOpen] = useState(false);
  const viewButtonRef = useRef(null);
  const viewPopoverRef = useRef(null);
  const [viewPopoverPos, setViewPopoverPos] = useState({ top: 0, left: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panRef = useRef({ active: false, startX: 0, startOffset: 0 });
  const [visibleSignals, setVisibleSignals] = useState({ ch1: true, ch2: true, ch3: true, ch4: true });
  const [showCursor, setShowCursor] = useState(true);
  const [cursorFrac, setCursorFrac] = useState(0.35);
  const [cursor2Frac, setCursor2Frac] = useState(0.65);
  const [showCursor2, setShowCursor2] = useState(true);
  const [cursorChannel, setCursorChannel] = useState('ch1');
  const [selectedBoardId, setSelectedBoardId] = useState('');
  const showCursorRef = useRef(true);
  const cursorFracRef = useRef(0.35);
  const cursor2FracRef = useRef(0.65);
  const showCursor2Ref = useRef(true);
  const cursorChannelRef = useRef('ch1');
  const isDraggingCursorRef = useRef(false);
  const activeCursorRef = useRef(1);
  const [, setTick] = useState(0);
  const onlineBoards = boards.filter((b) => b.status === 'online');
  connectedRef.current = connected;
  fsRef.current = meta.fs || 4000;
  showWaveformRef.current = showWaveform;
  showPlayheadRef.current = showPlayhead;
  showGridRef.current = showGrid;
  zoomLevelRef.current = zoomLevel;
  scaleModeRef.current = scaleMode;
  yMinManualRef.current = yMinManual;
  yMaxManualRef.current = yMaxManual;
  pausedRef.current = paused;
  scrollOffsetRef.current = scrollOffset;
  visibleSignalsRef.current = visibleSignals;
  showCursorRef.current = showCursor;
  cursorFracRef.current = cursorFrac;
  cursor2FracRef.current = cursor2Frac;
  showCursor2Ref.current = showCursor2;
  cursorChannelRef.current = cursorChannel;

  useEffect(() => {
    if (!selectedBoardId && onlineBoards.length > 0) {
      setSelectedBoardId(onlineBoards[0].id);
    }
  }, [onlineBoards, selectedBoardId]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setContainerWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!paused) {
      setScrollOffset(0);
      setViewPanelOpen(false);
    }
  }, [paused]);

  useEffect(() => {
    if (!viewPanelOpen) return;

    const POPOVER_W = 224;
    const MARGIN = 8;

    const position = () => {
      const btn = viewButtonRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const left = Math.max(
        MARGIN,
        Math.min(window.innerWidth - POPOVER_W - MARGIN, rect.right - POPOVER_W)
      );
      const top = rect.bottom + 8;
      setViewPopoverPos({ top, left });
    };

    const onDown = (e) => {
      const pop = viewPopoverRef.current;
      const btn = viewButtonRef.current;
      if (pop?.contains(e.target) || btn?.contains(e.target)) return;
      setViewPanelOpen(false);
    };

    position();
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    document.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
      document.removeEventListener('mousedown', onDown);
    };
  }, [viewPanelOpen]);

  useEffect(() => {
    if (!paused) return;
    const displayCountUI = Math.max(
      2,
      Math.min(sampleCount || 0, Math.round(DISPLAY_WAVEFORM_SAMPLES / (zoomLevel || 1)))
    );
    const maxOffset = Math.max(0, (sampleCount || 0) - displayCountUI);
    setScrollOffset((o) => Math.max(0, Math.min(maxOffset, o)));
  }, [paused, zoomLevel, sampleCount]);

  useEffect(() => {
    const id = setInterval(() => {
      setRunProgress((p) => (p >= 100 ? 0 : p + 1));
    }, 20);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!connected) return;
    const id = setInterval(() => setTick((t) => t + 1), 300);
    return () => clearInterval(id);
  }, [connected]);

  const RECONNECT_MS = 3000;

  useEffect(() => {
    const baseUrl = API_ENDPOINTS.WS_WAVEFORM || 'ws://localhost:8000/ws/waveform';
    const url = selectedBoardId
      ? `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}boardId=${encodeURIComponent(selectedBoardId)}`
      : baseUrl;
    let cancelled = false;
    let reconnectTimeoutId = null;

    const connect = () => {
      if (cancelled) return;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        bufferRef.current = { CH1: [], CH2: [], CH3: [], CH4: [] };
        setSampleCount(0);
        setLastChunkAt(null);
        if (!cancelled) {
          reconnectTimeoutId = setTimeout(connect, RECONNECT_MS);
        }
      };
      ws.onerror = () => setConnected(false);

      ws.onmessage = (event) => {
        if (pausedRef.current) return;
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'waveform') {
            const buffers = bufferRef.current;
            let ch1Count = 0;

            if (Array.isArray(msg.data?.channels)) {
              msg.data.channels.forEach((ch, idx) => {
                const id = ch?.id || `CH${idx + 1}`;
                if (!Array.isArray(ch?.samples)) return;
                if (!buffers[id]) buffers[id] = [];
                const arr = buffers[id];
                ch.samples.forEach((s) => {
                  arr.push(Number(s));
                  if (arr.length > MAX_WAVEFORM_SAMPLES) arr.shift();
                });
              });
              ch1Count = buffers.CH1 ? buffers.CH1.length : 0;
            } else if (Array.isArray(msg.data?.samples)) {
              if (!buffers.CH1) buffers.CH1 = [];
              const arr = buffers.CH1;
              msg.data.samples.forEach((s) => {
                arr.push(Number(s));
                if (arr.length > MAX_WAVEFORM_SAMPLES) arr.shift();
              });
              ch1Count = arr.length;
            }

            if (ch1Count > 0) {
              setLastChunkAt(Date.now());
              setSampleCount(ch1Count);
            }
            if (msg.data?.freq_hz != null) {
              setMeta((m) => ({
                ...m,
                freq_hz: msg.data.freq_hz,
                fs: msg.data.fs ?? m.fs,
              }));
            }
          }
        } catch (_) {}
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimeoutId) clearTimeout(reconnectTimeoutId);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(320, containerWidth);
    const h = WAVEFORM_CANVAS_HEIGHT;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    let stopped = false;
    const draw = () => {
      if (stopped) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
      const buffers = bufferRef.current;
      const buf = buffers.CH1 || [];
      const cw = w;
      const ch = h;

      ctx.fillStyle = '#f1f5f9';
      ctx.fillRect(0, 0, cw, ch);

      const padding = { left: 40, right: 20, top: 20, bottom: 30 };
      const plotLeft = padding.left;
      const plotRight = cw - padding.right;
      const plotTop = padding.top;
      const plotBottom = ch - padding.bottom;
      const plotW = plotRight - plotLeft;
      const plotH = plotBottom - plotTop;
      const midY = plotTop + plotH / 2;

      const bufHasData = buf.length >= 2;
      const zoom = zoomLevelRef.current;
      const displayCount = Math.max(2, Math.min(buf.length, Math.round(DISPLAY_WAVEFORM_SAMPLES / zoom)));
      const endIndex = Math.max(0, Math.min(buf.length, buf.length - (pausedRef.current ? (scrollOffsetRef.current || 0) : 0)));
      const startIndex = Math.max(0, endIndex - displayCount);
      const toDraw = bufHasData ? buf.slice(startIndex, endIndex) : null;
      const n = toDraw ? toDraw.length : displayCount;

      let yMin = yMinManualRef.current;
      let yMax = yMaxManualRef.current;
      if (scaleModeRef.current === 'manual') {
        if (yMin > yMax) {
          const t = yMin;
          yMin = yMax;
          yMax = t;
        }
      }
      if (scaleModeRef.current === 'auto' && toDraw && toDraw.length >= 2) {
        let minV = toDraw[0];
        let maxV = toDraw[0];
        for (let i = 1; i < toDraw.length; i++) {
          const v = Number(toDraw[i]);
          if (v < minV) minV = v;
          if (v > maxV) maxV = v;
        }
        let range = maxV - minV;
        if (range < 1e-6) range = 1;
        const pad = Math.max(range * 0.05, 0.05);
        range += pad * 2;
        const midVal = (minV + maxV) / 2;
        yMin = midVal - range / 2;
        yMax = midVal + range / 2;
      }
      const yRange = Math.max(yMax - yMin, 1e-6);
      const scaleY = plotH / yRange;
      const midVal = (yMin + yMax) / 2;

      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(plotLeft, plotTop);
      ctx.lineTo(plotLeft, plotBottom);
      ctx.stroke();

      if (showGridRef.current) {
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 1;
        for (let i = 0; i <= 5; i++) {
          const y = plotTop + (plotH * i) / 5;
          ctx.beginPath();
          ctx.moveTo(plotLeft, y);
          ctx.lineTo(plotRight, y);
          ctx.stroke();
        }
      }
      ctx.beginPath();
      ctx.moveTo(plotLeft, midY);
      ctx.lineTo(plotRight, midY);
      ctx.strokeStyle = '#94a3b8';
      ctx.stroke();

      ctx.fillStyle = '#64748b';
      ctx.font = '10px system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      const yTicks = [yMax, midVal, yMin];
      const yTickPositions = [plotTop, midY, plotBottom];
      for (let i = 0; i < 3; i++) {
        const y = yTickPositions[i];
        const v = yTicks[i];
        ctx.beginPath();
        ctx.moveTo(plotLeft - 4, y);
        ctx.lineTo(plotLeft, y);
        ctx.strokeStyle = '#94a3b8';
        ctx.stroke();
        const label = Math.abs(v) >= 10 || (v !== 0 && Math.abs(v) < 0.01) ? v.toExponential(1) : v.toFixed(2);
        ctx.fillText(label, plotLeft - 6, y);
      }
      const fs = fsRef.current || 4000;
      const totalSec = n / fs;

      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(plotLeft, plotBottom);
      ctx.lineTo(plotRight, plotBottom);
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const formatMs = (sec) => `${Math.round(sec * 1000)} ms`;
      const xTicks = [
        { x: plotLeft, t: 0 },
        { x: plotLeft + plotW / 2, t: totalSec / 2 },
        { x: plotRight, t: totalSec },
      ];
      xTicks.forEach(({ x, t }) => {
        ctx.beginPath();
        ctx.moveTo(x, plotBottom);
        ctx.lineTo(x, plotBottom + 4);
        ctx.strokeStyle = '#94a3b8';
        ctx.stroke();
        ctx.fillText(formatMs(t), x, plotBottom + 6);
      });

      if (showWaveformRef.current && connectedRef.current && bufHasData && toDraw) {
        const step = plotW / (n - 1);

        const drawChannel = (arr, color, width = 2) => {
          if (!arr || arr.length < 2) return;
          const seg = arr.slice(startIndex, endIndex);
          if (seg.length < 2) return;
          ctx.strokeStyle = color;
          ctx.lineWidth = width;
          ctx.lineJoin = 'round';
          ctx.lineCap = 'round';
          ctx.beginPath();
          for (let i = 0; i < n; i++) {
            const x = plotLeft + i * step;
            const v = Number(seg[i]);
            const y = midY - (v - midVal) * scaleY;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
        };

        const ch1 = buffers.CH1;
        const ch2 = buffers.CH2;
        const ch3 = buffers.CH3;
        const ch4 = buffers.CH4;

        if (visibleSignalsRef.current.ch1) drawChannel(ch1, '#0369a1', 2.2);
        if (visibleSignalsRef.current.ch2) drawChannel(ch2, '#ea580c', 1.6);
        if (visibleSignalsRef.current.ch3) drawChannel(ch3, '#16a34a', 1.6);
        if (visibleSignalsRef.current.ch4) drawChannel(ch4, '#7c3aed', 1.6);
      }

      if (showPlayheadRef.current) {
        const liveFrac = ((Date.now() % 2000) / 2000);
        const frac = pausedRef.current ? playheadFracRef.current : liveFrac;
        if (!pausedRef.current) playheadFracRef.current = frac;
        const playheadX = plotLeft + Math.max(0, Math.min(1, frac)) * plotW;
        ctx.strokeStyle = 'rgba(220, 38, 38, 0.9)';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(playheadX, plotTop);
        ctx.lineTo(playheadX, plotBottom);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      if (showCursorRef.current && bufHasData && toDraw && n >= 2) {
        const fs = fsRef.current || 4000;
        const chMap = { ch1: 'CH1', ch2: 'CH2', ch3: 'CH3', ch4: 'CH4' };
        const chKey = cursorChannelRef.current;
        const arr = buffers[chMap[chKey]];
        const seg = arr && arr.length >= 2 ? arr.slice(startIndex, endIndex) : null;

        const getTVAtFrac = (f) => {
          if (!seg) return { tMs: 0, v: 0 };
          const idx = f * (n - 1);
          const i0 = Math.min(Math.floor(idx), n - 2);
          const i1 = i0 + 1;
          const t = Math.max(0, Math.min(1, idx - i0));
          const v0 = Number(seg[i0]);
          const v1 = Number(seg[i1]);
          const v = v0 * (1 - t) + v1 * t;
          const tMs = (startIndex + idx) / fs * 1000;
          return { tMs, v };
        };

        const drawOneCursor = (frac, isSecond) => {
          const cursorX = plotLeft + frac * plotW;
          const lineColor = isSecond ? 'rgba(59, 130, 246, 0.9)' : 'rgba(15, 23, 42, 0.9)';
          ctx.strokeStyle = lineColor;
          ctx.lineWidth = 2;
          ctx.setLineDash([6, 4]);
          ctx.beginPath();
          ctx.moveTo(cursorX, plotTop);
          ctx.lineTo(cursorX, plotBottom);
          ctx.stroke();
          ctx.setLineDash([]);

          if (seg) {
            const { tMs, v } = getTVAtFrac(frac);
            const y = midY - (v - midVal) * scaleY;
            ctx.fillStyle = isSecond ? 'rgba(59, 130, 246, 0.95)' : 'rgba(15, 23, 42, 0.95)';
            ctx.strokeStyle = '#0f172a';
            ctx.lineWidth = 1.5;
            const sq = 6;
            ctx.fillRect(cursorX - sq / 2, y - sq / 2, sq, sq);
            ctx.strokeRect(cursorX - sq / 2, y - sq / 2, sq, sq);
            const label = `T: ${tMs.toFixed(2)} ms   V: ${v.toFixed(2)} V`;
            ctx.font = '11px system-ui, sans-serif';
            ctx.fillStyle = '#0f172a';
            ctx.textAlign = isSecond ? 'right' : 'left';
            ctx.textBaseline = 'middle';
            const tx = isSecond ? cursorX - 8 : cursorX + 8;
            const ty = Math.max(plotTop + 10, Math.min(plotBottom - 10, y));
            ctx.fillText(label, tx, ty);
          }
          return seg ? getTVAtFrac(frac) : null;
        };

        const data1 = drawOneCursor(Math.max(0, Math.min(1, cursorFracRef.current)), false);

        if (showCursor2Ref.current) {
          const data2 = drawOneCursor(Math.max(0, Math.min(1, cursor2FracRef.current)), true);
          if (data1 && data2) {
            const deltaT = data2.tMs - data1.tMs;
            const deltaV = data2.v - data1.v;
            ctx.font = '12px system-ui, sans-serif';
            ctx.fillStyle = '#0f172a';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            const midX = plotLeft + plotW / 2;
            ctx.fillText(`ΔT: ${deltaT.toFixed(2)} ms   ΔV: ${deltaV.toFixed(2)} V`, midX, plotTop + 4);
          }
        }
      }

      if (buf.length < 2 || !connectedRef.current) {
        ctx.fillStyle = '#64748b';
        ctx.font = '14px system-ui, sans-serif';
        ctx.textAlign = 'center';
        const msg = !connectedRef.current ? 'Lost of signal /  Backend Disconnected' : 'Waiting for samples…';
        ctx.fillText(msg, cw / 2, ch / 2);
      } else if (!showWaveformRef.current) {
        ctx.fillStyle = '#64748b';
        ctx.font = '14px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Waveform display paused', cw / 2, ch / 2);
      } else if (pausedRef.current) {
        ctx.fillStyle = '#64748b';
        ctx.font = '12px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Acquisition paused', cw / 2, plotTop + 14);
      }

      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => {
      stopped = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [connected, showWaveform, zoomLevel, containerWidth, paused]);

  const isLive = connected && lastChunkAt != null && Date.now() - lastChunkAt < 500;
  const LIVE_PULSE = 'animate-pulse';
  const displayCountUI = Math.max(
    2,
    Math.min(sampleCount || 0, Math.round(DISPLAY_WAVEFORM_SAMPLES / (zoomLevel || 1)))
  );
  const maxScrollOffset = Math.max(0, (sampleCount || 0) - displayCountUI);
  const scrollStep = Math.max(20, Math.round(displayCountUI * 0.2));
  const plotWUi = Math.max(1, (containerWidth || 800) - 40 - 20);
  const samplesPerPx = displayCountUI / plotWUi;

  const measureChannelMap = { ch1: 'CH1', ch2: 'CH2', ch3: 'CH3', ch4: 'CH4' };
  const measureBuf = bufferRef.current[measureChannelMap[cursorChannel]] || [];
  const measureEndIndex = Math.max(0, Math.min(measureBuf.length, measureBuf.length - (paused ? scrollOffset : 0)));
  const measureStartIndex = Math.max(0, measureEndIndex - displayCountUI);
  const measureSegment = measureBuf.length >= 2 ? measureBuf.slice(measureStartIndex, measureEndIndex) : [];
  const fs = meta.fs || 4000;

  let vpp = null;
  let freqHz = null;
  let dutyCycle = null;
  if (measureSegment.length >= 2) {
    let minV = measureSegment[0];
    let maxV = measureSegment[0];
    for (let i = 1; i < measureSegment.length; i++) {
      const v = Number(measureSegment[i]);
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    vpp = maxV - minV;
    const mid = (minV + maxV) / 2;
    let crossings = 0;
    for (let i = 0; i < measureSegment.length - 1; i++) {
      const a = Number(measureSegment[i]) - mid;
      const b = Number(measureSegment[i + 1]) - mid;
      if (a * b < 0) crossings++;
    }
    if (crossings >= 2) freqHz = (crossings / 2) * fs / measureSegment.length;
    let above = 0;
    for (let i = 0; i < measureSegment.length; i++) {
      if (Number(measureSegment[i]) > mid) above++;
    }
    dutyCycle = (above / measureSegment.length) * 100;
  }

  return (
    <div className="w-full min-w-0 space-y-6">
      <div className="bg-gradient-to-r from-slate-50 to-white rounded-2xl border border-slate-200/80 shadow-sm overflow-visible">
        <div className="p-3 sm:p-4 flex flex-col gap-3 sm:gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex items-center gap-2">
                <div className="p-1.5 sm:p-2 rounded-xl bg-sky-100 text-sky-600 dark:bg-sky-900/40 dark:text-sky-300">
                  <Activity size={20} className="sm:hidden" strokeWidth={2} />
                  <Activity size={22} className="hidden sm:block" strokeWidth={2} />
                </div>
                <div className="min-w-0">
                  <div className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 truncate">
                    Realtime Waveform
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                    {selectedBoardId
                      ? `Streaming from ${onlineBoards.find((b) => b.id === selectedBoardId)?.name || selectedBoardId}`
                      : 'Streaming from simulated node'}
                  </div>
                </div>
              </div>
              {connected ? (
                isLive ? (
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-500/15 text-emerald-700 border border-emerald-300/60 ${LIVE_PULSE}`}>
                    <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/50" />
                    Live
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-amber-500/15 text-amber-700 border border-amber-300/60">
                    <span className="w-2 h-2 rounded-full bg-amber-500" />
                    Waiting for data…
                  </span>
                )
              ) : (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-200/80 text-slate-600 border border-slate-300/60">
                  <span className="w-2 h-2 rounded-full bg-slate-400" />
                  Disconnected
                </span>
              )}
            </div>

            <div className="shrink-0 flex items-center gap-2">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Streaming from</span>
              <select
                value={selectedBoardId || ''}
                onChange={(e) => setSelectedBoardId(e.target.value)}
                className="px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Simulated Node</option>
                {onlineBoards.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name || b.id}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 flex-nowrap overflow-x-auto overflow-y-visible max-w-full pr-1 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="shrink-0">
              <button
                type="button"
                ref={viewButtonRef}
                onClick={() => setViewPanelOpen((v) => !v)}
                className="flex items-center gap-2 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-xl bg-cyan-50 dark:bg-cyan-900/30 border border-cyan-200/60 dark:border-cyan-700 text-cyan-900 dark:text-cyan-100 text-sm font-semibold hover:bg-cyan-100 dark:hover:bg-cyan-800 transition-colors"
                title="View & overlay options"
              >
                <Eye size={16} />
                View
              </button>
              {viewPanelOpen && (
                <div
                  ref={viewPopoverRef}
                  className="fixed w-56 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl p-3 z-[999]"
                  style={{ top: viewPopoverPos.top, left: viewPopoverPos.left }}
                >
                  <div className="text-xs font-bold text-slate-500 mb-2">Show on chart</div>
                  <div className="space-y-1">
                    <label className="flex items-center gap-2 py-1.5 text-sm text-slate-700 select-none">
                      <input type="checkbox" checked={showWaveform} onChange={(e) => setShowWaveform(e.target.checked)} className="w-4 h-4 shrink-0 rounded border-slate-300 text-sky-600 focus:ring-sky-500" />
                      Trace
                    </label>
                    <label className="flex items-center gap-2 py-1.5 text-sm text-slate-700 select-none">
                      <input type="checkbox" checked={showPlayhead} onChange={(e) => setShowPlayhead(e.target.checked)} className="w-4 h-4 shrink-0 rounded border-slate-300 text-rose-600 focus:ring-rose-500" />
                      Playhead
                    </label>
                    <label className="flex items-center gap-2 py-1.5 text-sm text-slate-700 select-none">
                      <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} className="w-4 h-4 shrink-0 rounded border-slate-300 text-slate-600 focus:ring-slate-500" />
                      Grid
                    </label>
                    <label className="flex items-center gap-2 py-1.5 text-sm text-slate-700 select-none">
                      <input type="checkbox" checked={showStats} onChange={(e) => setShowStats(e.target.checked)} className="w-4 h-4 shrink-0 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                      Stats
                    </label>
                    <label className="flex items-center gap-2 py-1.5 text-sm text-slate-700 select-none">
                      <input type="checkbox" checked={showCursor} onChange={(e) => setShowCursor(e.target.checked)} className="w-4 h-4 shrink-0 rounded border-slate-300 text-slate-600" />
                      Cursor (T / V)
                    </label>
                    {showCursor && (
                      <>
                        <label className="flex items-center gap-2 py-1 pl-6 text-sm text-slate-600 select-none">
                          <input type="checkbox" checked={showCursor2} onChange={(e) => setShowCursor2(e.target.checked)} className="w-4 h-4 rounded border-slate-300" />
                          Cursor 2 (ΔT / ΔV)
                        </label>
                        <div className="flex items-center gap-2 py-1 pl-6">
                          <span className="text-xs text-slate-500">Measure:</span>
                          <select value={cursorChannel} onChange={(e) => setCursorChannel(e.target.value)} className="text-xs border border-slate-200 rounded px-2 py-1 bg-white">
                            <option value="ch1">CH1</option>
                            <option value="ch2">CH2</option>
                            <option value="ch3">CH3</option>
                            <option value="ch4">CH4</option>
                          </select>
                        </div>
                      </>
                    )}
                  </div>
                  <div className="mt-3 pt-2 border-t border-slate-100">
                    <div className="text-xs font-bold text-slate-500 mb-1">Signals (analog)</div>
                    <div className="space-y-1">
                      <label className="flex items-center gap-2 py-1.5 text-sm text-slate-700 select-none">
                        <input type="checkbox" checked={visibleSignals.ch1} onChange={(e) => setVisibleSignals((prev) => ({ ...prev, ch1: e.target.checked }))} className="w-4 h-4 shrink-0 rounded border-slate-300 text-sky-600 focus:ring-sky-500" />
                        CH1
                      </label>
                      <label className="flex items-center gap-2 py-1.5 text-sm text-slate-700 select-none">
                        <input type="checkbox" checked={visibleSignals.ch2} onChange={(e) => setVisibleSignals((prev) => ({ ...prev, ch2: e.target.checked }))} className="w-4 h-4 shrink-0 rounded border-slate-300 text-orange-500 focus:ring-orange-500" />
                        CH2
                      </label>
                      <label className="flex items-center gap-2 py-1.5 text-sm text-slate-700 select-none">
                        <input type="checkbox" checked={visibleSignals.ch3} onChange={(e) => setVisibleSignals((prev) => ({ ...prev, ch3: e.target.checked }))} className="w-4 h-4 shrink-0 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
                        CH3
                      </label>
                      <label className="flex items-center gap-2 py-1.5 text-sm text-slate-700 select-none">
                        <input type="checkbox" checked={visibleSignals.ch4} onChange={(e) => setVisibleSignals((prev) => ({ ...prev, ch4: e.target.checked }))} className="w-4 h-4 shrink-0 rounded border-slate-300 text-violet-600 focus:ring-violet-500" />
                        CH4
                      </label>
                    </div>
                  </div>
                  <div className="mt-2 pt-2 border-t border-slate-100 flex justify-end">
                    <button type="button" className="text-xs font-semibold text-slate-600 hover:text-slate-900" onClick={() => setViewPanelOpen(false)}>
                      Close
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center gap-1 shrink-0 rounded-xl overflow-hidden border border-slate-200 bg-slate-100/80 p-0.5">
              <button
                type="button"
                onClick={() => { setPaused((p) => !p); setScrollOffset(0); }}
                className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1 sm:py-1.5 text-sm font-semibold rounded-lg transition-all ${paused ? 'bg-amber-500 text-white shadow-sm' : 'text-slate-600 hover:bg-amber-100 hover:text-amber-700'}`}
                title={paused ? 'Resume' : 'Pause'}
              >
                {paused ? <Play size={16} /> : <Pause size={16} />}
                {paused ? 'Resume' : 'Pause'}
              </button>
              <button
                type="button"
                onClick={() => { bufferRef.current = { CH1: [], CH2: [], CH3: [], CH4: [] }; setSampleCount(0); setLastChunkAt(null); }}
                className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1 sm:py-1.5 text-sm font-semibold text-slate-600 hover:bg-rose-100 hover:text-rose-700 rounded-lg transition-all"
                title="Clear buffer"
              >
                <Trash2 size={16} />
                Clear
              </button>
            </div>

            {paused && maxScrollOffset > 0 && (
              <div className="flex items-center gap-2 shrink-0 px-2 py-1 sm:py-1.5 rounded-xl border border-slate-200 bg-white/70">
                <span className="text-xs font-bold text-slate-500">Scroll</span>
                <button type="button" onClick={() => setScrollOffset((o) => Math.min(maxScrollOffset, o + scrollStep))} className="p-1.5 rounded-lg text-slate-600 hover:bg-slate-200 transition-colors" title="Scroll left (older)">
                  <ChevronLeft size={16} />
                </button>
                <input type="range" min={0} max={maxScrollOffset} step={1} value={scrollOffset} onChange={(e) => setScrollOffset(Number(e.target.value))} className="w-24 accent-slate-600" title="Scroll offset" />
                <button type="button" onClick={() => setScrollOffset((o) => Math.max(0, o - scrollStep))} className="p-1.5 rounded-lg text-slate-600 hover:bg-slate-200 transition-colors" title="Scroll right (newer)">
                  <ChevronRight size={16} />
                </button>
                <span className="text-[11px] font-semibold text-slate-500 tabular-nums">
                  {Math.round((scrollOffset / (meta.fs || 4000)) * 1000)} ms
                </span>
              </div>
            )}

            <div className="flex items-center gap-0.5 shrink-0 rounded-xl overflow-hidden border border-violet-200/80 bg-violet-50/50 p-0.5">
              <button type="button" onClick={() => setZoomLevel((z) => Math.min(32, z * 1.5))} className="p-2 text-violet-600 hover:bg-violet-200/80 rounded-lg transition-colors" title="Zoom in">
                <ZoomIn size={18} />
              </button>
              <button type="button" onClick={() => setZoomLevel((z) => Math.max(0.25, z / 1.5))} className="p-2 text-violet-600 hover:bg-violet-200/80 rounded-lg transition-colors" title="Zoom out">
                <ZoomOut size={18} />
              </button>
              <button type="button" onClick={() => setZoomLevel(1)} className="px-2.5 py-1.5 text-xs font-bold text-violet-700 bg-violet-200/60 hover:bg-violet-300/80 rounded-lg transition-colors" title="Reset zoom">
                1×
              </button>
            </div>

            <div className="flex items-center gap-2 shrink-0 px-2 py-1 sm:py-1.5 rounded-xl border border-indigo-200/80 bg-indigo-50/50">
              <Gauge size={16} className="text-indigo-600 shrink-0" />
              <div className="flex rounded-lg overflow-hidden border border-indigo-200/60 bg-white">
                <button type="button" onClick={() => setScaleMode('auto')} className={`px-2.5 py-1 text-xs font-semibold transition-all ${scaleMode === 'auto' ? 'bg-indigo-600 text-white' : 'text-indigo-600 hover:bg-indigo-100'}`}>
                  Auto
                </button>
                <button type="button" onClick={() => setScaleMode('manual')} className={`px-2.5 py-1 text-xs font-semibold transition-all ${scaleMode === 'manual' ? 'bg-indigo-600 text-white' : 'text-indigo-600 hover:bg-indigo-100'}`}>
                  Manual
                </button>
              </div>
              {scaleMode === 'manual' && (
                <div className="flex items-center gap-1.5">
                  <input type="number" step="0.1" value={yMinManual} onChange={(e) => setYMinManual(parseFloat(e.target.value) || 0)} className="w-12 sm:w-14 px-2 py-1 text-xs font-medium border border-indigo-200 rounded-md bg-white focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400" placeholder="Min" />
                  <span className="text-indigo-400 font-bold">→</span>
                  <input type="number" step="0.1" value={yMaxManual} onChange={(e) => setYMaxManual(parseFloat(e.target.value) || 0)} className="w-12 sm:w-14 px-2 py-1 text-xs font-medium border border-indigo-200 rounded-md bg-white focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400" placeholder="Max" />
                </div>
              )}
            </div>

            {showStats && sampleCount > 0 && (
              <span className="px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-200/80 text-slate-700 border border-slate-300/60">
                {sampleCount.toLocaleString()} samples
              </span>
            )}
          </div>
        </div>
      </div>

      <div
        ref={containerRef}
        className={`w-full bg-white rounded-2xl border border-slate-200 shadow-card overflow-hidden touch-none ${
          paused ? (isPanning ? 'cursor-grabbing' : 'cursor-grab') : ''
        }`}
        onWheel={(e) => {
          if (!paused) return;
          if (maxScrollOffset <= 0) return;
          e.preventDefault();
          const raw = e.deltaX !== 0 ? -e.deltaX : e.deltaY;
          const dir = raw > 0 ? 1 : -1;
          setScrollOffset((o) => Math.max(0, Math.min(maxScrollOffset, o + dir * scrollStep)));
        }}
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          const el = containerRef.current;
          if (!el) return;
          const rect = el.getBoundingClientRect();
          const plotLeft = 40;
          const plotW = Math.max(1, rect.width - 60);
          const localX = e.clientX - rect.left;
          const frac = Math.max(0, Math.min(1, (localX - plotLeft) / plotW));

          if (showCursorRef.current && localX >= plotLeft && localX <= plotLeft + plotW) {
            if (!showCursor2Ref.current) {
              activeCursorRef.current = 1;
              setCursorFrac(frac);
            } else {
              const f1 = cursorFracRef.current;
              const f2 = cursor2FracRef.current;
              const dist1 = Math.abs(frac - f1);
              const dist2 = Math.abs(frac - f2);
              if (dist1 <= dist2) {
                activeCursorRef.current = 1;
                setCursorFrac(frac);
              } else {
                activeCursorRef.current = 2;
                setCursor2Frac(frac);
              }
            }
            isDraggingCursorRef.current = true;
            e.currentTarget.setPointerCapture?.(e.pointerId);
            return;
          }
          if (!paused) return;
          if (maxScrollOffset <= 0) return;
          e.currentTarget.setPointerCapture?.(e.pointerId);
          panRef.current = { active: true, startX: e.clientX, startOffset: scrollOffsetRef.current || 0 };
          setIsPanning(true);
        }}
        onPointerMove={(e) => {
          if (isDraggingCursorRef.current) {
            const el = containerRef.current;
            if (!el) return;
            const rect = el.getBoundingClientRect();
            const plotLeft = 40;
            const plotW = Math.max(1, rect.width - 60);
            const localX = e.clientX - rect.left;
            const frac = Math.max(0, Math.min(1, (localX - plotLeft) / plotW));
            if (activeCursorRef.current === 1) setCursorFrac(frac);
            else setCursor2Frac(frac);
            return;
          }
          if (!panRef.current.active) return;
          if (!paused) return;
          if (maxScrollOffset <= 0) return;
          e.preventDefault();
          const dx = e.clientX - panRef.current.startX;
          const deltaSamples = Math.round(dx * samplesPerPx);
          const next = panRef.current.startOffset + deltaSamples;
          setScrollOffset(Math.max(0, Math.min(maxScrollOffset, next)));
        }}
        onPointerUp={(e) => {
          if (isDraggingCursorRef.current) {
            isDraggingCursorRef.current = false;
            e.currentTarget.releasePointerCapture?.(e.pointerId);
            return;
          }
          if (!panRef.current.active) return;
          e.currentTarget.releasePointerCapture?.(e.pointerId);
          panRef.current.active = false;
          setIsPanning(false);
        }}
        onPointerCancel={(e) => {
          if (isDraggingCursorRef.current) {
            isDraggingCursorRef.current = false;
            e.currentTarget.releasePointerCapture?.(e.pointerId);
            return;
          }
          if (!panRef.current.active) return;
          e.currentTarget.releasePointerCapture?.(e.pointerId);
          panRef.current.active = false;
          setIsPanning(false);
        }}
      >
        <canvas ref={canvasRef} className="block w-full max-w-full border-0" style={{ background: '#f1f5f9' }} />
      </div>

      <div className="mt-3 pt-3 border-t border-slate-200">
        <div className="text-xs font-bold text-slate-500 mb-2">Real-time measurements ({cursorChannel.toUpperCase()})</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-slate-50 rounded-lg px-3 py-2 border border-slate-200/80">
            <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Vpp</div>
            <div className="text-sm font-bold text-slate-800 tabular-nums">
              {vpp != null ? `${vpp.toFixed(2)} V` : '—'}
            </div>
          </div>
          <div className="bg-slate-50 rounded-lg px-3 py-2 border border-slate-200/80">
            <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Freq</div>
            <div className="text-sm font-bold text-slate-800 tabular-nums">
              {freqHz != null ? (freqHz >= 1000 ? `${(freqHz / 1000).toFixed(2)} kHz` : `${freqHz.toFixed(1)} Hz`) : '—'}
            </div>
          </div>
          <div className="bg-slate-50 rounded-lg px-3 py-2 border border-slate-200/80">
            <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Duty cycle</div>
            <div className="text-sm font-bold text-slate-800 tabular-nums">
              {dutyCycle != null ? `${dutyCycle.toFixed(1)} %` : '—'}
            </div>
          </div>
          <div className="bg-slate-50 rounded-lg px-3 py-2 border border-slate-200/80">
            <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Sampling rate</div>
            <div className="text-sm font-bold text-slate-800 tabular-nums">
              {fs >= 1000000 ? `${(fs / 1000000).toFixed(1)} MHz` : fs >= 1000 ? `${(fs / 1000).toFixed(1)} kHz` : `${fs} Hz`}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WaveformPage;

